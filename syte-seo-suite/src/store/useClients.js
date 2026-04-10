import { create } from 'zustand';
import { fetchClients, upsertClient, deleteClient } from '../lib/supabase.js';

const SELECTED_KEY = 'syte-suite:selected-client';

export const useClients = create((set, get) => ({
  clients: [],
  selectedId: localStorage.getItem(SELECTED_KEY) || null,
  loading: false,
  error: null,

  get selected() {
    return get().clients.find((c) => c.id === get().selectedId) || null;
  },

  load: async () => {
    set({ loading: true, error: null });
    try {
      const clients = await fetchClients();
      let selectedId = get().selectedId;
      if (!selectedId && clients.length) selectedId = clients[0].id;
      if (selectedId && !clients.find((c) => c.id === selectedId)) {
        selectedId = clients[0]?.id || null;
      }
      set({ clients, selectedId, loading: false });
      if (selectedId) localStorage.setItem(SELECTED_KEY, selectedId);
    } catch (e) {
      set({ error: e.message, loading: false });
    }
  },

  select: (id) => {
    set({ selectedId: id });
    if (id) localStorage.setItem(SELECTED_KEY, id);
  },

  save: async (client) => {
    const saved = await upsertClient(client);
    await get().load();
    if (saved?.id) get().select(saved.id);
    return saved;
  },

  remove: async (id) => {
    await deleteClient(id);
    await get().load();
  },

  getSelected: () => get().clients.find((c) => c.id === get().selectedId) || null,
}));
