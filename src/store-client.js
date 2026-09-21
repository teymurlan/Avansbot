export function storeStub(env) {
  if (!env.AVANS_STORE) throw new Error('Общее хранилище AVANS_STORE не подключено');
  const id = env.AVANS_STORE.idFromName('mangal-city-main');
  return env.AVANS_STORE.get(id);
}

export async function storeCall(env, path, options = {}) {
  const stub = storeStub(env);
  const response = await stub.fetch(new Request(`https://store${path}`, options));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Ошибка общего хранилища');
  return data;
}
