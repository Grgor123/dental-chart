// Standard calendar-event column-packing algorithm, shared by Day and Week
// grid rendering (TimeGrid.tsx) for laying out overlapping appointments
// side by side within a single resource/day column. Pure function, no
// React dependency, so it's trivially unit-testable and reusable across
// both views.
export interface TimedEvent {
  id: string;
  startMinutes: number;
  endMinutes: number;
}

export interface LaidOutEvent {
  id: string;
  columnIndex: number;
  columnCount: number;
}

export function layoutOverlappingEvents(events: TimedEvent[]): LaidOutEvent[] {
  const sorted = [...events].sort((a, b) => a.startMinutes - b.startMinutes);
  const result = new Map<string, { columnIndex: number }>();

  let cluster: TimedEvent[] = [];
  let clusterEnd = -Infinity;

  const clusterColumnCounts = new Map<string, number>();

  const flushCluster = () => {
    if (cluster.length === 0) return;
    // Greedily assign each event (in start-time order) to the lowest
    // column index whose last-assigned event has already ended.
    const columnEndTimes: number[] = [];
    for (const event of cluster) {
      let columnIndex = columnEndTimes.findIndex((endTime) => endTime <= event.startMinutes);
      if (columnIndex === -1) {
        columnIndex = columnEndTimes.length;
        columnEndTimes.push(event.endMinutes);
      } else {
        columnEndTimes[columnIndex] = event.endMinutes;
      }
      result.set(event.id, { columnIndex });
    }
    // Every event in a cluster shares that cluster's own max column count,
    // so a chip narrower than its own overlap group never happens.
    const columnCount = columnEndTimes.length;
    cluster.forEach((event) => clusterColumnCounts.set(event.id, columnCount));
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const event of sorted) {
    if (cluster.length > 0 && event.startMinutes >= clusterEnd) {
      flushCluster();
    }
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, event.endMinutes);
  }
  flushCluster();

  return sorted.map((event) => ({
    id: event.id,
    columnIndex: result.get(event.id)!.columnIndex,
    columnCount: clusterColumnCounts.get(event.id) ?? 1,
  }));
}
