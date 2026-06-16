import { Badge } from "../../components/ui";

// Faithful copy of the reference IMS DashboardTab (read-only stats + upcoming + low-stock).
export default function DashboardTab({ projects, functions, inventory }) {
  const today = new Date().toISOString().split("T")[0];
  const totalStock = inventory.reduce((s, i) => s + i.qty, 0);
  const totalBlocked = inventory.reduce((s, i) => s + (i.blocked || 0), 0);
  const totalAvail = totalStock - totalBlocked;
  const lowStock = inventory.filter((i) => (i.qty - (i.blocked || 0)) <= 2 && (i.qty - (i.blocked || 0)) >= 0);
  const activeProjects = projects.filter((p) => p.status === "Active");
  const confirmedFns = functions.filter((f) => f.status === "Confirmed");
  const upcoming = functions.filter((f) => f.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const stats = [
    ["📦 Total Items", inventory.length, "indigo"],
    ["📊 Total Stock", totalStock, "blue"],
    ["✅ Available", totalAvail, "green"],
    ["🔒 Blocked", totalBlocked, "amber"],
    ["📁 Active Projects", activeProjects.length, "purple"],
    ["🎉 Confirmed Fns", confirmedFns.length, "teal"],
    ["⚠️ Low Stock", lowStock.length, "red"],
    ["★ Premium", inventory.filter((i) => i.type === "Premium").length, "pink"],
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map(([l, v, c]) => (
          <div key={l} className={`bg-white rounded-2xl p-4 border border-${c}-100 shadow-sm`}>
            <p className="text-xs text-gray-500 mb-1">{l}</p>
            <p className={`text-3xl font-bold text-${c}-600`}>{v}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border rounded-2xl p-5">
          <h3 className="font-semibold text-gray-800 mb-3">📅 Upcoming Functions</h3>
          {upcoming.length === 0 && <p className="text-sm text-gray-400 italic">No upcoming functions</p>}
          {upcoming.map((fn) => {
            const proj = projects.find((p) => p.functions?.includes(fn.id));
            return (
              <div key={fn.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-800">{fn.name} <span className="text-gray-400 font-normal">— {proj?.name}</span></p>
                  <p className="text-xs text-gray-500">{fn.date} · {fn.venue?.name || "TBD"}</p>
                </div>
                <Badge color={fn.status === "Confirmed" ? "green" : "amber"}>{fn.status}</Badge>
              </div>
            );
          })}
        </div>
        <div className="bg-white border rounded-2xl p-5">
          <h3 className="font-semibold text-gray-800 mb-3">⚠️ Low Stock Alerts</h3>
          {lowStock.length === 0 && <p className="text-sm text-green-600 font-medium">All items adequately stocked ✓</p>}
          {lowStock.map((i) => (
            <div key={i.id} className="flex items-center justify-between py-2 border-b last:border-0">
              <div>
                <p className="text-sm font-medium text-gray-800">{i.name}</p>
                <p className="text-xs text-gray-500">{i.cat} · {i.loc}</p>
              </div>
              <span className="text-sm font-bold text-red-600">{i.qty - (i.blocked || 0)} left</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
