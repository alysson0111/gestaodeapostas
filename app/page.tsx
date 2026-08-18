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
import { db } from "./firebase";

type BetStatus = "pending" | "won" | "lost" | "void";

type BetSelection = {
  event: string;
  market: string;
  odd: number;
};

type FormSelection = {
  id: string;
  event: string;
  market: string;
  odd: string;
};

type Bet = {
  id: string;
  date: string;
  event: string;
  ticketKind?: "single" | "multiple";
  selections?: string[];
  selectionDetails?: BetSelection[];
  market: string;
  type: string;
  odd: number;
  stake: number;
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
  void: "Anulada",
};

const initialBets: Bet[] = [
  {
    id: "demo-1",
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
  return 0;
}

function selectionsForBet(bet: Bet) {
  if (bet.selectionDetails?.length) return bet.selectionDetails.map((selection) => selection.event);
  if (bet.selections?.length) return bet.selections;
  return bet.event ? [bet.event] : [];
}

function emptySelection(id: string): FormSelection {
  return { id, event: "", market: "", odd: "1.50" };
}

function emptyForm() {
  return {
    date: new Date().toISOString().slice(0, 10),
    event: "",
    ticketKind: "single" as "single" | "multiple",
    multipleSelections: [emptySelection("leg-1"), emptySelection("leg-2")],
    market: "",
    type: "Resultado",
    odd: "1.80",
    stake: "50",
    status: "pending" as BetStatus,
    notes: "",
  };
}

export default function Home() {
  const [bets, setBets] = useState<Bet[]>(initialBets);
  const [form, setForm] = useState(emptyForm);
  const [statusFilter, setStatusFilter] = useState<"all" | BetStatus>("all");
  const [typeFilter, setTypeFilter] = useState("Todos");

  useEffect(() => {
    const saved = window.localStorage.getItem("bet-control-records");
    const savedBets = saved ? (JSON.parse(saved) as Bet[]) : [];

    const unsubscribe = onSnapshot(
      collection(db, "bets"),
      async (snapshot) => {
        const remoteBets = snapshot.docs.map((document) => ({
          ...(document.data() as Bet),
          id: document.id,
        }));

        if (remoteBets.length === 0 && savedBets.length > 0) {
          const batch = writeBatch(db);
          savedBets.forEach((bet) => {
            batch.set(doc(db, "bets", bet.id), bet);
          });
          await batch.commit();
          setBets(savedBets);
          return;
        }

        setBets(remoteBets);
        window.localStorage.setItem("bet-control-records", JSON.stringify(remoteBets));
      },
      () => {
        if (savedBets.length > 0) setBets(savedBets);
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
      .filter((bet) => typeFilter === "Todos" || bet.type === typeFilter)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [bets, statusFilter, typeFilter]);

  const metrics = useMemo(() => {
    const settled = bets.filter((bet) => bet.status === "won" || bet.status === "lost");
    const invested = settled.reduce((sum, bet) => sum + bet.stake, 0);
    const profit = settled.reduce((sum, bet) => sum + profitForBet(bet), 0);
    const wins = settled.filter((bet) => bet.status === "won").length;
    const averageOdd =
      settled.length > 0
        ? settled.reduce((sum, bet) => sum + bet.odd, 0) / settled.length
        : 0;

    return {
      total: bets.length,
      pending: bets.filter((bet) => bet.status === "pending").length,
      invested,
      profit,
      roi: invested > 0 ? profit / invested : 0,
      hitRate: settled.length > 0 ? wins / settled.length : 0,
      averageOdd,
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
      if (bet.status === "won" || bet.status === "lost") {
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
    return [...bets]
      .sort((a, b) => a.date.localeCompare(b.date))
      .filter((bet) => bet.status !== "pending")
      .map((bet) => {
        balance += profitForBet(bet);
        return { label: bet.date.slice(5), balance };
      });
  }, [bets]);

  const multipleOdd = useMemo(() => {
    if (form.ticketKind !== "multiple") return Number(form.odd);
    const odds = form.multipleSelections
      .map((selection) => Number(selection.odd))
      .filter((odd) => odd > 1);
    if (odds.length === 0) return 0;
    return odds.reduce((total, odd) => total * odd, 1);
  }, [form.multipleSelections, form.odd, form.ticketKind]);

  function updateMultipleSelection(id: string, field: keyof Omit<FormSelection, "id">, value: string) {
    setForm((current) => ({
      ...current,
      multipleSelections: current.multipleSelections.map((selection) =>
        selection.id === id ? { ...selection, [field]: value } : selection,
      ),
    }));
  }

  function addMultipleSelection() {
    setForm((current) => ({
      ...current,
      multipleSelections: [
        ...current.multipleSelections,
        emptySelection(`leg-${Date.now()}`),
      ],
    }));
  }

  function removeMultipleSelection(id: string) {
    setForm((current) => ({
      ...current,
      multipleSelections:
        current.multipleSelections.length > 2
          ? current.multipleSelections.filter((selection) => selection.id !== id)
          : current.multipleSelections,
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stake = Number(form.stake);
    let odd = Number(form.odd);
    let eventName = form.event.trim();
    let market = form.market.trim();
    let selections = eventName ? [eventName] : [];
    let selectionDetails: BetSelection[] | undefined;

    if (form.ticketKind === "multiple") {
      const filledSelections = form.multipleSelections.map((selection) => ({
        event: selection.event.trim(),
        market: selection.market.trim(),
        odd: Number(selection.odd),
      }));

      if (
        filledSelections.length < 2 ||
        filledSelections.some((selection) => !selection.event || !selection.market || selection.odd <= 1)
      ) {
        return;
      }

      selectionDetails = filledSelections;
      selections = selectionDetails.map((selection) => selection.event);
      odd = selectionDetails.reduce((total, selection) => total * selection.odd, 1);
      eventName = eventName || `${selectionDetails.length} selecoes`;
      market = market || "Multipla";
    }

    if (!eventName || !market || odd <= 1 || stake <= 0) return;

    const newBet = {
      id: crypto.randomUUID(),
      date: form.date,
      event: eventName,
      ticketKind: form.ticketKind,
      selections,
      selectionDetails,
      market,
      type:
        form.ticketKind === "multiple" && form.type === "Resultado"
          ? "Multipla"
          : form.type.trim() || "Outros",
      odd,
      stake,
      status: form.status,
      notes: form.notes.trim(),
    };

    setBets((current) => [newBet, ...current]);
    void setDoc(doc(db, "bets", newBet.id), newBet);
    setForm(emptyForm());
  }

  function updateStatus(id: string, status: BetStatus) {
    setBets((current) =>
      current.map((bet) => (bet.id === id ? { ...bet, status } : bet)),
    );
    void setDoc(doc(db, "bets", id), { status }, { merge: true });
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
            <Metric label="Investido" value={currency.format(metrics.invested)} />
            <Metric label="Acerto" value={percent.format(metrics.hitRate)} />
            <Metric label="Odd media" value={metrics.averageOdd.toFixed(2)} />
            <Metric label="Resolvidas" value={String(metrics.settled)} />
          </div>
        </div>
      </section>

      <section className="content-left dashboard-grid grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[300px_1fr] lg:px-5">
        <form onSubmit={handleSubmit} className="bet-form h-fit rounded-lg border border-[#d7dfd4] bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Nova aposta</h2>
              <p className="text-sm text-[#64736b]">Registre a odd, stake e mercado.</p>
            </div>
          </div>

          <div className="grid gap-3">
            <label>
              Data
              <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
            </label>
            <label>
              Formato do bilhete
              <select
                value={form.ticketKind}
                onChange={(event) =>
                  setForm({
                    ...form,
                    ticketKind: event.target.value as "single" | "multiple",
                    type: event.target.value === "multiple" ? "Multipla" : form.type,
                  })
                }
              >
                <option value="single">Simples</option>
                <option value="multiple">Dupla / multipla</option>
              </select>
            </label>
            <label>
              {form.ticketKind === "multiple" ? "Nome do bilhete" : "Evento"}
              <input
                placeholder={form.ticketKind === "multiple" ? "Ex: Dupla Champions League" : "Ex: Botafogo x Vasco"}
                value={form.event}
                onChange={(event) => setForm({ ...form, event: event.target.value })}
              />
            </label>
            {form.ticketKind === "multiple" && (
              <div className="multiple-builder">
                <div className="multiple-builder-head">
                  <strong>Selecoes do bilhete</strong>
                  <button type="button" onClick={addMultipleSelection}>
                    + Selecao
                  </button>
                </div>
                {form.multipleSelections.map((selection, index) => (
                  <div className="selection-card" key={selection.id}>
                    <div className="selection-card-head">
                      <span>Selecao {index + 1}</span>
                      {form.multipleSelections.length > 2 && (
                        <button type="button" onClick={() => removeMultipleSelection(selection.id)}>
                          Remover
                        </button>
                      )}
                    </div>
                    <label>
                      Time / evento
                      <input
                        placeholder="Ex: Real Madrid vence"
                        value={selection.event}
                        onChange={(event) => updateMultipleSelection(selection.id, "event", event.target.value)}
                      />
                    </label>
                    <div className="grid grid-cols-[1fr_80px] gap-2">
                      <label>
                        Mercado
                        <input
                          placeholder="Ex: Over 1.5 gols"
                          value={selection.market}
                          onChange={(event) => updateMultipleSelection(selection.id, "market", event.target.value)}
                        />
                      </label>
                      <label>
                        Odd
                        <input
                          type="number"
                          min="1.01"
                          step="0.01"
                          value={selection.odd}
                          onChange={(event) => updateMultipleSelection(selection.id, "odd", event.target.value)}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <label>
              {form.ticketKind === "multiple" ? "Tipo da multipla" : "Mercado"}
              <input
                placeholder={form.ticketKind === "multiple" ? "Ex: Dupla, tripla, acumulada" : "Ex: Over 2.5 gols"}
                value={form.market}
                onChange={(event) => setForm({ ...form, market: event.target.value })}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>
                Tipo
                <input value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} />
              </label>
              <label>
                Status
                <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as BetStatus })}>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label>
                {form.ticketKind === "multiple" ? "Odd total" : "Odd"}
                <input
                  type="number"
                  min="1.01"
                  step="0.01"
                  readOnly={form.ticketKind === "multiple"}
                  value={form.ticketKind === "multiple" ? multipleOdd.toFixed(2) : form.odd}
                  onChange={(event) => setForm({ ...form, odd: event.target.value })}
                />
              </label>
              <label>
                Stake
                <input type="number" min="1" step="1" value={form.stake} onChange={(event) => setForm({ ...form, stake: event.target.value })} />
              </label>
            </div>
            <label>
              Observacao
              <textarea rows={3} placeholder="Leitura do jogo, fonte ou regra da entrada" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </label>
            <button className="primary-button" type="submit">+ Cadastrar aposta</button>
          </div>
        </form>

        <div className="grid gap-6">
          <div className="grid gap-6 xl:grid-cols-[1fr_330px]">
            <section className="rounded-lg border border-[#d7dfd4] bg-white shadow-sm">
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

              <div className="overflow-x-auto">
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
                            <button onClick={() => updateStatus(bet.id, "won")} aria-label="Marcar green">G</button>
                            <button onClick={() => updateStatus(bet.id, "lost")} aria-label="Marcar red">R</button>
                            <button onClick={() => updateStatus(bet.id, "void")} aria-label="Anular">A</button>
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
                <div className="chart" aria-label="Curva de lucro acumulado">
                  {curve.length === 0 ? (
                    <p>Feche apostas para ver a evolucao.</p>
                  ) : (
                    curve.map((point, index) => {
                      const max = Math.max(...curve.map((item) => Math.abs(item.balance)), 1);
                      const height = Math.max(8, (Math.abs(point.balance) / max) * 120);
                      return (
                        <div className="bar-wrap" key={`${point.label}-${index}`}>
                          <span className={point.balance >= 0 ? "bar positive-bar" : "bar negative-bar"} style={{ height }} />
                          <small>{point.label}</small>
                        </div>
                      );
                    })
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
