/**
 * Glance stat tile (DESIGN-SPEC 5.4): key/value pair inside the console
 * "how it works" summary strip and the report-card stat row. Server
 * component.
 */
export function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-black border border-b1 rounded-lg p-2.5">
      <p className="text-kicker uppercase text-t3">{label}</p>
      <p className="text-xl font-bold tnum text-t1">{value}</p>
    </div>
  );
}
