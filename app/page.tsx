"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { db } from "./firebase";

type BetStatus = "pending" | "won" | "lost" | "void";

type BetSelection = {
  event: string;
  market: string;
  odd: number;
};

type Bet = {
  id: string;
  createdAt: number;
  date: string;
  event: string;
  ticketKind?: "single" | "multiple";
  selections?: string[];
  selectionDetails?: BetSelection[];
  market: string;
  type: string;
  odd: number;
  stake: number;
  cashout?: number;
  status: BetStatus;
  notes: string;
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const percent = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const statusLabels: Record<BetStatus, string> = {
  pending: "Aberta",
  won: "Green",
  lost: "Red",
  void: "Push",
};

const initialBets: Bet[] = [
  {
    id: "demo-1",
    createdAt: 1,
    date: "2026-08-12",
    event: "Palmeiras x Bahia",
    ticketKind: "single",
    selections: ["Palmeiras x Bahia"],
    market: "Over 2.5 gols",
    type: "Gols",
    odd: 1.92,
    stake: 50,
    status: "won",
    notes: "Entrada pre-live.",
  },
  {
    id: "demo-2",
    createdAt: 2,
    date: "2026-08-13",
    event: "Corinthians x Santos",
    ticketKind: "single",
    selections: ["Corinthians x Santos"],
    market: "Ambas marcam",
    type: "BTTS",
    odd: 2.1,
    stake: 40,
    status: "lost",
    notes: "Jogo travado no primeiro tempo.",
  },
  {
    id: "demo-3",
    createdAt: 3,
    date: "2026-08-15",
    event: "Dupla brasileira",
    ticketKind: "multiple",
    selections: ["Flamengo vence", "Atletico-MG ou empate"],
    selectionDetails: [
      { event: "Flamengo vence", market: "Resultado", odd: 1.45 },
      { event: "Atletico-MG ou empate", market: "Dupla chance", odd: 1.67 },
    ],
    market: "Dupla",
    type: "Multipla",
    odd: 2.42,
    stake: 60,
    status: "pending",
    notes: "Aguardando fechamento.",
  },
];

function profitForBet(bet: Bet) {
  if (bet.status === "won") return bet.stake * (bet.odd - 1);
  if (bet.status === "lost") return -bet.stake;
  if (bet.status === "void") return (bet.cashout ?? bet.stake) - bet.stake;
  return 0;
}

function parseMoneyInput(value: string) {
  const trimmed = value.trim();
  if (trimmed.includes(",")) return Number(trimmed.replace(/\./g, "").replace(",", "."));
  return Number(trimmed);
}

function selectionsForBet(bet: Bet) {
  if (bet.selectionDetails?.length) return bet.selectionDetails.map((selection) => selection.event);
  if (bet.selections?.length) return bet.selections;
  return bet.event ? [bet.event] : [];
}

function emptyForm() {
  return {
    type: "Simples",
    odd: "1.80",
    stake: "50,00",
  };
}

function sortByInsertionOrder(list: Bet[]) {
  return [...list].sort((a, b) => a.createdAt - b.createdAt);
}

function normalizeBet(data: Partial<Bet>, id: string, fallbackCreatedAt = Date.now()): Bet {
  const fallbackDate = new Date().toISOString().slice(0, 10);
  const ticketKind = data.ticketKind === "multiple" ? "multiple" : "single";
  const event = data.event || "Aposta sem evento";
  const selectionDetails = Array.isArray(data.selectionDetails)
    ? data.selectionDetails
        .map((selection) => ({
          event: selection?.event || "",
          market: selection?.market || "",
          odd: Number(selection?.odd) || 1,
        }))
        .filter((selection) => selection.event)
    : undefined;
  const selections = selectionDetails?.length
    ? selectionDetails.map((selection) => selection.event)
    : Array.isArray(data.selections) && data.selections.length > 0
      ? data.selections.filter(Boolean)
      : [event];

  return {
    id,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : fallbackCreatedAt,
    date: data.date || fallbackDate,
    event,
    ticketKind,
    selections,
    selectionDetails,
    market: data.market || "Mercado",
    type: data.type || (ticketKind === "multiple" ? "Multipla" : "Resultado"),
    odd: Number(data.odd) || 1,
    stake: Number(data.stake) || 0,
    cashout: typeof data.cashout === "number" ? data.cashout : undefined,
    status: data.status ?? "pending",
    notes: data.notes || "",
  };
}

function formFromBet(bet: Bet) {
  return {
    type: bet.type,
    odd: bet.odd.toFixed(2),
    stake: bet.stake.toFixed(2).replace(".", ","),
  };
}

export default function Home() {
  const [bets, setBets] = useState<Bet[]>(initialBets);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | BetStatus>("all");
  const [typeFilter, setTypeFilter] = useState("Todos");

  useEffect(() => {
    const saved = window.localStorage.getItem("bet-control-records");
    const savedBets = saved
      ? (JSON.parse(saved) as Partial<Bet>[]).map((bet, index) =>
          normalizeBet(bet, bet.id || `saved-${index}`, index + 1),
        )
      : [];

    const unsubscribe = onSnapshot(
      collection(db, "bets"),
      async (snapshot) => {
        const remoteBets = snapshot.docs.map((document, index) =>
          normalizeBet(document.data() as Partial<Bet>, document.id, index + 1),
        );
        const orderedRemoteBets = sortByInsertionOrder(remoteBets);

        const missingOrder = snapshot.docs.some(
          (document) => typeof (document.data() as Partial<Bet>).createdAt !== "number",
        );

        if (missingOrder && remoteBets.length > 0) {
          const batch = writeBatch(db);
          snapshot.docs.forEach((document, index) => {
            if (typeof (document.data() as Partial<Bet>).createdAt !== "number") {
              batch.set(doc(db, "bets", document.id), { createdAt: remoteBets[index].createdAt }, { merge: true });
            }
          });
          await batch.commit();
        }

        if (remoteBets.length === 0 && savedBets.length > 0) {
          const batch = writeBatch(db);
          savedBets.forEach((bet) => {
            batch.set(doc(db, "bets", bet.id), bet);
          });
          await batch.commit();
          setBets(sortByInsertionOrder(savedBets));
          return;
        }

        setBets(orderedRemoteBets);
        window.localStorage.setItem("bet-control-records", JSON.stringify(orderedRemoteBets));
      },
      () => {
        if (savedBets.length > 0) setBets(sortByInsertionOrder(savedBets));
      },
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    window.localStorage.setItem("bet-control-records", JSON.stringify(bets));
  }, [bets]);

  const betTypes = useMemo(
    () => ["Todos", ...Array.from(new Set(bets.map((bet) => bet.type))).sort()],
    [bets],
  );

  const filteredBets = useMemo(() => {
    return bets
      .filter((bet) => statusFilter === "all" || bet.status === statusFilter)
      .filter((bet) => typeFilter === "Todos" || bet.type === typeFilter);
  }, [bets, statusFilter, typeFilter]);

  const metrics = useMemo(() => {
    const settled = bets.filter((bet) => bet.status === "won" || bet.status === "lost" || bet.status === "void");
    const invested = settled.reduce((sum, bet) => sum + bet.stake, 0);
    const profit = settled.reduce((sum, bet) => sum + profitForBet(bet), 0);
    const wins = settled.filter((bet) => bet.status === "won").length;
    const averageStake =
      bets.length > 0 ? bets.reduce((sum, bet) => sum + bet.stake, 0) / bets.length : 0;
    const averageOdd =
      settled.length > 0
        ? settled.reduce((sum, bet) => sum + bet.odd, 0) / settled.length
        : 0;

    return {
      total: bets.length,
      pending: bets.filter((bet) => bet.status === "pending").length,
      green: bets.filter((bet) => bet.status === "won").length,
      red: bets.filter((bet) => bet.status === "lost").length,
      push: bets.filter((bet) => bet.status === "void").length,
      invested,
      profit,
      roi: invested > 0 ? profit / invested : 0,
      hitRate: settled.length > 0 ? wins / settled.length : 0,
      averageOdd,
      averageStake,
      settled: settled.length,
    };
  }, [bets]);

  const byType = useMemo(() => {
    const groups = new Map<string, { type: string; stake: number; profit: number; count: number }>();
    bets.forEach((bet) => {
      const current = groups.get(bet.type) ?? {
        type: bet.type,
        stake: 0,
        profit: 0,
        count: 0,
      };
      if (bet.status === "won" || bet.status === "lost" || bet.status === "void") {
        current.stake += bet.stake;
        current.profit += profitForBet(bet);
      }
      current.count += 1;
      groups.set(bet.type, current);
    });
    return Array.from(groups.values()).sort((a, b) => b.profit - a.profit);
  }, [bets]);

  const curve = useMemo(() => {
    let balance = 0;
    const settledCurve = sortByInsertionOrder(bets)
      .filter((bet) => bet.status !== "pending")
      .map((bet) => {
        balance += profitForBet(bet);
        return { label: bet.date.slice(5), balance };
      });

    return settledCurve.length > 0 ? [{ label: "0", balance: 0 }, ...settledCurve] : [];
  }, [bets]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stake = parseMoneyInput(form.stake);
    const odd = parseMoneyInput(form.odd);
    const betType = form.type.trim() || "Simples";
    const isMultiple = betType.toLowerCase() !== "simples";
    const existingBet = editingId ? bets.find((bet) => bet.id === editingId) : undefined;

    if (odd <= 1 || stake <= 0) return;

    const savedBet: Bet = {
      id: editingId ?? crypto.randomUUID(),
      createdAt: existingBet?.createdAt ?? Date.now(),
      date: existingBet?.date ?? new Date().toISOString().slice(0, 10),
      event: existingBet?.event && editingId ? existingBet.event : betType,
      ticketKind: isMultiple ? "multiple" : "single",
      selections: existingBet?.selections && editingId ? existingBet.selections : [betType],
      market: existingBet?.market && editingId ? existingBet.market : betType,
      type: betType,
      odd,
      stake,
      status: existingBet?.status ?? "pending",
      notes: existingBet?.notes ?? "",
    };

    if (existingBet?.selectionDetails) savedBet.selectionDetails = existingBet.selectionDetails;
    if (typeof existingBet?.cashout === "number") savedBet.cashout = existingBet.cashout;

    setBets((current) =>
      editingId
        ? current.map((bet) => (bet.id === editingId ? savedBet : bet))
        : [...current, savedBet],
    );
    void setDoc(doc(db, "bets", savedBet.id), savedBet);
    setEditingId(null);
    setForm(emptyForm());
  }

  function startEdit(bet: Bet) {
    setEditingId(bet.id);
    setForm(formFromBet(bet));
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm());
  }

  function updateStatus(id: string, status: BetStatus) {
    const bet = bets.find((item) => item.id === id);
    let cashout: number | undefined;

    if (status === "void") {
      const defaultCashout = currency.format(bet?.cashout ?? bet?.stake ?? 0);
      const typedCashout = window.prompt("Valor do cashout / retorno do Push:", defaultCashout);

      if (typedCashout === null) return;

      cashout = parseMoneyInput(typedCashout.replace(/[^\d,.-]/g, ""));
      if (!Number.isFinite(cashout) || cashout < 0) return;
    }

    setBets((current) =>
      current.map((bet) => (bet.id === id ? { ...bet, status, cashout } : bet)),
    );
    void setDoc(
      doc(db, "bets", id),
      status === "void" ? { status, cashout } : { status, cashout: null },
      { merge: true },
    );
  }

  function removeBet(id: string) {
    setBets((current) => current.filter((bet) => bet.id !== id));
    void deleteDoc(doc(db, "bets", id));
  }

  return (
    <main className="app-shell min-h-screen text-[#14221d]">
      <section className="top-strip">
        <div className="content-left flex max-w-7xl flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-5">
          <div>
            <p className="section-kicker">
              Controle de apostas esportivas
            </p>
            <h1>Gestao de banca</h1>
          </div>

          <div className="metric-grid top-metrics">
            <Metric label="Lucro" value={currency.format(metrics.profit)} tone={metrics.profit >= 0 ? "good" : "bad"} />
            <Metric label="ROI" value={percent.format(metrics.roi)} tone={metrics.roi >= 0 ? "good" : "bad"} />
            <Metric label="Apostas" value={String(metrics.total)} />
            <Metric label="Abertas" value={String(metrics.pending)} />
            <Metric label="Green" value={String(metrics.green)} tone="good" />
            <Metric label="Red" value={String(metrics.red)} tone="bad" />
            <Metric label="Push" value={String(metrics.push)} />
            <Metric label="Investido" value={currency.format(metrics.invested)} />
            <Metric label="Acerto" value={percent.format(metrics.hitRate)} />
            <Metric label="Odd media" value={metrics.averageOdd.toFixed(2)} />
            <Metric label="Resolvidas" value={String(metrics.settled)} />
            <Metric label="Stake media" value={currency.format(metrics.averageStake)} />
          </div>
        </div>
      </section>

      <section className="content-left dashboard-grid grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[300px_1fr] lg:px-5">
        <form onSubmit={handleSubmit} className="bet-form h-fit rounded-lg border border-[#d7dfd4] bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">{editingId ? "Editar aposta" : "Nova aposta"}</h2>
              <p className="text-sm text-[#64736b]">
                {editingId ? "Altere e salve." : "Cadastre odd, stake e tipo."}
              </p>
            </div>
          </div>

          <div className="grid gap-3 simple-form">
            <label>
              Tipo de aposta
              <select
                value={form.type}
                onChange={(event) => setForm({ ...form, type: event.target.value })}
              >
                <option value="Simples">Simples</option>
                <option value="Dupla">Dupla</option>
                <option value="Tripla">Tripla</option>
                <option value="Multipla">Multipla</option>
                <option value="Ao vivo">Ao vivo</option>
                <option value="Outros">Outros</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>
                Odd
                <input
                  inputMode="decimal"
                  min="1.01"
                  pattern="[0-9.,]*"
                  value={form.odd}
                  onChange={(event) => setForm({ ...form, odd: event.target.value })}
                />
              </label>
              <label>
                Stake
                <input inputMode="decimal" min="0.01" pattern="[0-9.,]*" value={form.stake} onChange={(event) => setForm({ ...form, stake: event.target.value })} />
              </label>
            </div>
            <div className="form-actions">
              <button className="primary-button" type="submit">
                {editingId ? "Salvar aposta" : "+ Cadastrar aposta"}
              </button>
              {editingId && (
                <button className="secondary-button" type="button" onClick={cancelEdit}>
                  Cancelar
                </button>
              )}
            </div>
          </div>
        </form>

        <div className="bets-content grid gap-6">
          <div className="main-content-grid grid gap-6 xl:grid-cols-[1fr_330px]">
            <section className="bets-panel rounded-lg border border-[#d7dfd4] bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-[#e3e8df] p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-bold">Apostas cadastradas</h2>
                  <p className="text-sm text-[#64736b]">Atualize o resultado quando a aposta fechar.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | BetStatus)}>
                    <option value="all">Todos os status</option>
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                    {betTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </div>
              </div>

              <div className="table-scroll overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Evento</th>
                      <th>Bilhete</th>
                      <th>Tipo</th>
                      <th>Odd</th>
                      <th>Stake</th>
                      <th>Resultado</th>
                      <th>Lucro</th>
                      <th>Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBets.map((bet) => (
                      <tr key={bet.id}>
                        <td>{bet.date}</td>
                        <td>
                          <strong className="event-name">{bet.event}</strong>
                          <span>{bet.market}</span>
                        </td>
                        <td>
                          <TicketDetails bet={bet} />
                        </td>
                        <td>{bet.type}</td>
                        <td>{bet.odd.toFixed(2)}</td>
                        <td>{currency.format(bet.stake)}</td>
                        <td><StatusBadge status={bet.status} /></td>
                        <td className={profitForBet(bet) >= 0 ? "positive" : "negative"}>{currency.format(profitForBet(bet))}</td>
                        <td>
                          <div className="row-actions">
                            <button onClick={() => startEdit(bet)} aria-label="Editar">E</button>
                            <button onClick={() => updateStatus(bet.id, "won")} aria-label="Marcar green">G</button>
                            <button onClick={() => updateStatus(bet.id, "lost")} aria-label="Marcar red">R</button>
                            <button onClick={() => updateStatus(bet.id, "void")} aria-label="Marcar push">P</button>
                            <button onClick={() => removeBet(bet.id)} aria-label="Excluir">x</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredBets.length === 0 && (
                      <tr>
                        <td colSpan={9} className="empty-state">Nenhuma aposta encontrada para os filtros atuais.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <aside className="grid gap-6">
              <section className="rounded-lg border border-[#d7dfd4] bg-white p-5 shadow-sm">
                <h2 className="text-xl font-bold">Curva da banca</h2>
                <div className="line-chart" aria-label="Curva de lucro acumulado">
                  {curve.length === 0 ? (
                    <p>Feche apostas para ver a evolucao.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={curve} margin={{ top: 18, right: 18, bottom: 18, left: 18 }}>
                        <CartesianGrid stroke="#bcc4ba" strokeWidth={1} />
                        <XAxis dataKey="label" hide />
                        <YAxis hide domain={["auto", "auto"]} />
                        <Tooltip
                          cursor={{ stroke: "#ff6a1a", strokeWidth: 1 }}
                          formatter={(value) => [currency.format(Number(value)), "Banca"]}
                          labelFormatter={(label) => (label === "0" ? "Inicio" : `Data ${label}`)}
                          contentStyle={{
                            border: "1px solid #d7dfd4",
                            borderRadius: 8,
                            boxShadow: "0 10px 20px rgba(20, 34, 29, 0.12)",
                            fontSize: 12,
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="balance"
                          stroke="#ff6a1a"
                          strokeWidth={3}
                          dot={{ r: 5, fill: "#ff6a1a", stroke: "#ff6a1a", strokeWidth: 2 }}
                          activeDot={{ r: 7, fill: "#ff6a1a", stroke: "#ffffff", strokeWidth: 2 }}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-[#d7dfd4] bg-white p-5 shadow-sm">
                <h2 className="text-xl font-bold">ROI por tipo</h2>
                <div className="type-list">
                  {byType.map((item) => {
                    const roi = item.stake > 0 ? item.profit / item.stake : 0;
                    return (
                      <div key={item.type} className="type-row">
                        <div>
                          <strong>{item.type}</strong>
                          <span>{item.count} apostas</span>
                        </div>
                        <div className={roi >= 0 ? "positive" : "negative"}>
                          {percent.format(roi)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-[#dbe4d7] bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#6f7f74]">{label}</p>
      <strong className={tone === "good" ? "metric-good" : tone === "bad" ? "metric-bad" : ""}>
        {value}
      </strong>
    </div>
  );
}

function TicketDetails({ bet }: { bet: Bet }) {
  const selections = selectionsForBet(bet);
  const isMultiple = bet.ticketKind === "multiple" || selections.length > 1;
  const details = bet.selectionDetails ?? [];

  return (
    <div className="ticket-details">
      <span className={`ticket-kind ${isMultiple ? "multiple" : "single"}`}>
        {isMultiple ? `${selections.length} selecoes` : "Simples"}
      </span>
      {isMultiple && details.length > 0 && (
        <ul>
          {details.map((selection, index) => (
            <li key={`${bet.id}-${selection.event}-${index}`}>
              <strong>{selection.event}</strong>
              <span>{selection.market} @ {selection.odd.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}
      {isMultiple && details.length === 0 && (
        <ul>
          {selections.map((selection, index) => (
            <li key={`${bet.id}-${selection}-${index}`}>{selection}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: BetStatus }) {
  return <span className={`status ${status}`}>{statusLabels[status]}</span>;
}
