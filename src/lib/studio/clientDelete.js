// ═══ DELETE A CLIENT (admin) ═══
//
// Shared by the Client Tracker (Manage → Settings → Clients) and the Summary footer, because two
// hand-written copies of an irreversible operation drift — and the copy that drifts is the one
// that forgets a guard.
//
// This is a HARD delete: the row leaves `client_ledger` and takes the client's sessions, draft and
// history with it. saveClientLedger's second argument is the deleted-id list it turns into
// deleteRow calls; the plumbing had existed unused until this.
//
// What it deliberately does NOT delete: event orders. They are matched to a client by clientId, so
// they outlive the row — but they are IMS's copy of the job, not ours to remove. The confirm counts
// them and says they will be orphaned, so the decision is made with open eyes rather than silently.

export function makeDeleteClient({
  clientLedger,
  saveClientLedger,
  eventOrders,
  activeClientId,
  setActiveClientId,
  askConfirm,
  showMsg,
  onDeleted,
}) {
  return (c) => {
    if (!c?.id) return;
    const sessions = (c.sessions || []).length;
    const orders = (eventOrders || []).filter((e) => e.clientId === c.id).length;

    const bits = [sessions ? `${sessions} saved session${sessions === 1 ? "" : "s"}` : "no saved sessions"];
    if (c.status === "booked") bits.push("this client is marked BOOKED");
    if (orders) bits.push(`${orders} event order${orders === 1 ? "" : "s"} will be left without a client`);

    askConfirm(
      `Delete "${c.name}" permanently?`,
      () => {
        // Clear the selection before the row goes: deleting the client the builder is sitting on
        // would otherwise leave every downstream lookup resolving to nothing.
        if (activeClientId === c.id) setActiveClientId?.(null);
        saveClientLedger((clientLedger || []).filter((x) => x.id !== c.id), [c.id]);
        showMsg?.(`Deleted ${c.name}`, "green");
        onDeleted?.(c);
      },
      {
        yesLabel: "Delete forever",
        note: `${bits.join(" · ")}. This cannot be undone — mark the client Dead instead if you only want it out of the way.`,
      },
    );
  };
}
