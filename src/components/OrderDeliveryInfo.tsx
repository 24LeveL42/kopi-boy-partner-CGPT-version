import { deliveryDestination, formatScheduledFor, isExpress, type OrderDeliveryDetails } from "@/lib/order-delivery";

/** Express badge, requested time, drop-off address/unit and the customer's notes. */
export function OrderDeliveryInfo({ details }: { details: OrderDeliveryDetails }) {
  const { address, unit, notes } = deliveryDestination(details);
  const scheduled = Boolean(details.scheduled_for);
  return (
    <div className="mt-3 rounded-xl p-3 text-xs" style={{ background: "var(--kb-field)", color: "var(--kb-ink)" }}>
      <div className="flex flex-wrap items-center gap-1.5">
        {isExpress(details) ? (
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" style={{ background: "var(--kb-danger)" }}>
            ⚡ Express
          </span>
        ) : (
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--kb-ink-soft)" }}>
            Normal delivery
          </span>
        )}
        <span className="font-semibold" style={{ color: scheduled ? "var(--kb-purple)" : "var(--kb-ink-soft)" }}>
          🕒 {formatScheduledFor(details.scheduled_for)}
        </span>
      </div>
      <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--kb-ink-soft)" }}>Deliver to</p>
      <p className="font-semibold">{address}</p>
      {unit && <p>Unit {unit}</p>}
      {notes && (
        <p className="mt-1.5 rounded-lg px-2 py-1.5 font-semibold" style={{ background: "#FEF3C7", color: "#92400E" }}>
          Note: {notes}
        </p>
      )}
    </div>
  );
}
