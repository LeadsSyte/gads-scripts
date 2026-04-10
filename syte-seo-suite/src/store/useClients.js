import { create } from 'zustand';
import { listClients, upsertClient, deleteClient } from '../lib/supabase.js';

export const useClients = create((set, get) => ({
  clients: [],
  selectedId: null,
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null });
    try {
      const clients = await listClients();
      let selectedId = get().selectedId;
      const lastId = localStorage.getItem('syte-suite-selected-client');
      if (!selectedId && lastId && clients.some(c => c.id === lastId)) selectedId = lastId;
      if (!selectedId && clients.length) selectedId = clients[0].id;
      set({ clients, selectedId, loading: false });
    } catch (e) {
      set({ error: e.message, loading: false });
    }
  },

  select(id) {
    localStorage.setItem('syte-suite-selected-client', id || '');
    set({ selectedId: id });
  },

  async save(client) {
    const saved = await upsertClient(client);
    await get().load();
    if (saved?.id) get().select(saved.id);
    return saved;
  },

  async remove(id) {
    await deleteClient(id);
    if (get().selectedId === id) set({ selectedId: null });
    await get().load();
  },

  current() {
    return get().clients.find(c => c.id === get().selectedId) || null;
  }
}));
