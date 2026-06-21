export interface AreaEntry {
  area_id: string;
  name: string;
  icon: string | null;
  floor_id: string | null;
}

export interface FloorEntry {
  floor_id: string;
  name: string;
  level: number | null;
}

export interface DeviceEntry {
  id: string;
  area_id: string | null;
}

export interface EntityEntry {
  entity_id: string;
  area_id: string | null;
  device_id: string | null;
  name: string | null;
  original_name: string | null;
  hidden_by: string | null;
  disabled_by: string | null;
  entity_category: string | null;
  platform?: string | null;
}

export interface Registries {
  areas: AreaEntry[];
  floors: FloorEntry[];
  devices: DeviceEntry[];
  entities: EntityEntry[];
}

interface ConnLike {
  sendMessagePromise<T>(msg: { type: string }): Promise<T>;
  subscribeEvents(cb: (ev: unknown) => void, eventType: string): Promise<() => void>;
}

export async function fetchRegistries(conn: ConnLike): Promise<Registries> {
  const [areas, floors, devices, entities] = await Promise.all([
    conn.sendMessagePromise<AreaEntry[]>({ type: 'config/area_registry/list' }),
    conn.sendMessagePromise<FloorEntry[]>({ type: 'config/floor_registry/list' }),
    conn.sendMessagePromise<DeviceEntry[]>({ type: 'config/device_registry/list' }),
    conn.sendMessagePromise<EntityEntry[]>({ type: 'config/entity_registry/list' })
  ]);
  return { areas, floors, devices, entities };
}

const REGISTRY_EVENTS = [
  'area_registry_updated',
  'entity_registry_updated',
  'device_registry_updated',
  'floor_registry_updated'
];

export async function subscribeRegistryEvents(
  conn: ConnLike,
  onChange: () => void
): Promise<() => void> {
  const unsubs = await Promise.all(
    REGISTRY_EVENTS.map((ev) => conn.subscribeEvents(() => onChange(), ev))
  );
  return () => unsubs.forEach((u) => u());
}
