"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type BetStatus = "pending" | "won" | "lost" | "void";

type Bet = {
  id: string;
  date: string;
  event: string;
  ticketKind?: "single" | "multiple";
  selections?: string[];
  market: string;
  type: string;
  odd: number;
  stake: number;
  status: BetStatus;
  notes: string;
};

const startBank = 200;

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const percent = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const statusLabels: Record<BetStatus, string> = {
  pending: "Push",
  won: "Green",
  lost: "Red",
  void: "Push",
};

const initialBets: Bet[] = [
  {
    id: "demo-1",
    date: "2026-08-12",
    event: "Palmeiras x Bahia",
    ticketKind: "single",
    selections: ["Palmeiras x Bahia"],
    market: "Over 2.5 gols",
    type: "Futebol",
    odd: 1.92,
    stake: 100,
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
    type: "Futebol",
    odd: 2.1,
    stake: 100,
    status: "lost",
    notes: "Jogo travado no primeiro tempo.",
  },
  {
    id: "demo-3",
    date: "2026-08-15",
    event: "Dupla brasileira",
    ticketKind: "multiple",
    selections: ["Flamengo vence", "Atletico-MG ou empate"],
    market: "Dupla",
    type: "Futebol",
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
  if (bet.selections?.length) return bet.selections;
  return bet.event ? [bet.event] : [];
}

function formatDate(value: string) {
  const [, month, day] = value.split("-");
  return day && month ? `${day}.${month}` : value;
}

function emptyForm() {
  return {
    date: new Date().toISOString().slice(0, 10),
    event: "",
    ticketKind: "single" as "single" | "multiple",
    selections: "",
    market: "",
    type: "Futebol",
    odd: "1.80",
    stake: "100",
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
    if (saved) setBets(JSON.parse(saved));
  }, []);

  useEffect(() => {
    window.localStorage.setItem("bet-control-records", JSON.stringify(bets));
  }, [bets]);

  const sortedBets = useMemo(
    () => [...bets].sort((a, b) => a.date.localeCompare(b.date)),
    [bets],
  );

  const betTypes = useMemo(
    () => ["Todos", ...Array.from(new Set(bets.map((bet) => bet.type))).sort()],
    [bets],
  );

  const filteredRows = useMemo(() => {
    let runningBank = startBank;
    return sortedBets
      .map((bet) => {
        const profit = profitForBet(bet);
        runningBank += profit;
        return {
          bet,
          runningBank,
          profit,
          bankPercent: (runningBank - startBank) / startBank,
          dayPercent: profit / startBank,
        };
      })
      .filter(({ bet }) => statusFilter === "all" || bet.status === statusFilter)
      .filter(({ bet }) => typeFilter === "Todos" || bet.type === typeFilter)
      .reverse();
  }, [sortedBets, statusFilter, typeFilter]);

  const metrics = useMemo(() => {
    const settled = bets.filter((bet) => bet.status === "won" || bet.status === "lost");
    const profit = settled.reduce((sum, bet) => sum + profitForBet(bet), 0);
    const allStake = bets.reduce((sum, bet) => sum + bet.stake, 0);
    const wins = settled.filter((bet) => bet.status === "won").length;
    const reds = settled.filter((bet) => bet.status === "lost").length;
    const push = bets.filter((bet) => bet.status === "pending" || bet.status === "void").length;
    const averageStake = bets.length ? allStake / bets.length : 0;

    return {
      currentBank: startBank + profit,
      allStake,
      profit,
      roi: startBank > 0 ? profit / startBank : 0,
      wins,
      reds,
      push,
      averageStake,
      unit: startBank / 40,
      splitByThree: profit / 3,
    };
  }, [bets]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const odd = Number(form.odd);
    const stake = Number(form.stake);
    const selections = form.selections
      .split("\n")
      .map((selection) => selection.trim())
      .filter(Boolean);
    const eventName =
      form.ticketKind === "multiple"
        ? form.event.trim() || `${selections.length} selecoes`
        : form.event.trim();

    if (!eventName || !form.market.trim() || odd <= 1 || stake <= 0) return;
    if (form.ticketKind === "multiple" && selections.length < 2) return;

    setBets((current) => [
      {
        id: crypto.randomUUID(),
        date: form.date,
        event: eventName,
        ticketKind: form.ticketKind,
        selections: form.ticketKind === "multiple" ? selections : [eventName],
        market: form.market.trim(),
        type: form.type.trim() || "Futebol",
        odd,
        stake,
        status: form.status,
        notes: form.notes.trim(),
      },
      ...current,
    ]);
    setForm(emptyForm());
  }

  function updateStatus(id: string, status: BetStatus) {
    setBets((current) =>
      current.map((bet) => (bet.id === id ? { ...bet, status } : bet)),
    );
  }

  function removeBet(id: string) {
    setBets((current) => current.filter((bet) => bet.id !== id));
  }

  return (
    <main className="sheet-page">
      <section className="sheet">
        <header className="summary-grid" aria-label="Resumo da banca">
          <div className="summary-title">FUTEBOL</div>
          <SummaryBox label="Banca Inicio" value={currency.format(startBank)} tone="green" />
          <SummaryBox label="Stake" value={currency.format(metrics.averageStake)} tone="green" />
          <SummaryBox label="Unidade" value={metrics.unit.toFixed(2)} tone="green" />
          <SummaryBox label="Banca Atual" value={currency.format(metrics.currentBank)} tone="green" />
          <SummaryBox label="Green" value={String(metrics.wins)} tone="lime" />
          <SummaryBox label="Push" value={String(metrics.push)} tone="yellow" />
          <SummaryBox label="Red" value={String(metrics.reds)} tone="red" />
          <SummaryBox label="ROI" value={percent.format(metrics.roi)} tone="cyan" />
          <div className="summary-spacer" />
          <SummaryBox label="Investimento" value={currency.format(metrics.allStake)} tone="gold" />
          <SummaryBox label="Lucro/Perda" value={currency.format(metrics.profit)} tone="profit" />
          <SummaryBox label="Dividir por 3" value={currency.format(metrics.splitByThree)} tone="blue" />
        </header>

        <form className="sheet-form" onSubmit={handleSubmit}>
          <strong>Cadastrar aposta</strong>
          <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          <select
            value={form.ticketKind}
            onChange={(event) =>
              setForm({
                ...form,
                ticketKind: event.target.value as "single" | "multiple",
                type: event.target.value === "multiple" ? "Futebol" : form.type,
              })
            }
          >
            <option value="single">Simples</option>
            <option value="multiple">Dupla / multipla</option>
          </select>
          <input placeholder="Tip / mercado" value={form.market} onChange={(event) => setForm({ ...form, market: event.target.value })} />
          <input placeholder="Evento ou bilhete" value={form.event} onChange={(event) => setForm({ ...form, event: event.target.value })} />
          <input placeholder="Origem" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} />
          <input type="number" min="1" step="1" value={form.stake} onChange={(event) => setForm({ ...form, stake: event.target.value })} />
          <input type="number" min="1.01" step="0.01" value={form.odd} onChange={(event) => setForm({ ...form, odd: event.target.value })} />
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as BetStatus })}>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {form.ticketKind === "multiple" && (
            <input className="wide-input" placeholder="Selecoes separadas por ;" value={form.selections.replace(/\n/g, "; ")} onChange={(event) => setForm({ ...form, selections: event.target.value.replace(/;/g, "\n") })} />
          )}
          <button type="submit">Salvar</button>
        </form>

        <div className="filter-row">
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

        <div className="sheet-table-wrap">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Tip</th>
                <th>Data</th>
                <th>Origem</th>
                <th>Stake</th>
                <th>Odd</th>
                <th>Banca Total</th>
                <th>% banca</th>
                <th>Lucro</th>
                <th>% do dia</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(({ bet, runningBank, profit, bankPercent, dayPercent }) => (
                <tr key={bet.id}>
                  <td className={`status-cell ${bet.status}`}>
                    <span>{bet.status === "won" ? "↑" : bet.status === "lost" ? "↓" : "•"}</span>
                  </td>
                  <td className="tip-cell">
                    <strong>{bet.market || bet.type}</strong>
                    <small>{selectionsForBet(bet).join(" | ")}</small>
                  </td>
                  <td>{formatDate(bet.date)}</td>
                  <td>{bet.type}</td>
                  <td>{currency.format(bet.stake)}</td>
                  <td>{bet.status === "pending" ? currency.format(0) : bet.odd.toFixed(2)}</td>
                  <td className={runningBank < 0 ? "red-text" : ""}>{currency.format(runningBank)}</td>
                  <td>{percent.format(bankPercent)}</td>
                  <td className={profit < 0 ? "red-text" : ""}>{currency.format(profit)}</td>
                  <td>{percent.format(dayPercent)}</td>
                  <td>
                    <div className="sheet-actions">
                      <button type="button" onClick={() => updateStatus(bet.id, "won")}>G</button>
                      <button type="button" onClick={() => updateStatus(bet.id, "lost")}>R</button>
                      <button type="button" onClick={() => updateStatus(bet.id, "void")}>P</button>
                      <button type="button" onClick={() => removeBet(bet.id)}>X</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={11}>Nenhuma aposta encontrada.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function SummaryBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "green" | "lime" | "yellow" | "red" | "cyan" | "gold" | "profit" | "blue";
}) {
  return (
    <div className={`summary-box ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
