import type {
  AuditEventDto,
  DeletionStatusDto,
  DeviceDto,
  Paginated,
  UpdateMeInput,
  UsageDto,
  UserDto,
} from '@nexus/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/data/queries/client';
import { api } from '@/infra/apiClient';
import { useSessionStore, toSessionUser } from '@/stores/session';

/** The signed-in user (S-29, S-36); only while signed in. */
export function useMe() {
  const authed = useSessionStore((s) => s.status === 'authed');
  return useQuery({ queryKey: qk.me(), queryFn: () => api<UserDto>('/v1/me'), enabled: authed });
}

export function useUsage() {
  const authed = useSessionStore((s) => s.status === 'authed');
  return useQuery({
    queryKey: qk.usage(),
    queryFn: () => api<UsageDto>('/v1/me/usage'),
    enabled: authed,
  });
}

export function useAudit() {
  const authed = useSessionStore((s) => s.status === 'authed');
  return useQuery({
    queryKey: ['me', 'audit'],
    queryFn: () => api<Paginated<AuditEventDto>>('/v1/me/audit?limit=20'),
    enabled: authed,
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMeInput) => api<UserDto>('/v1/me', { method: 'PATCH', body: input }),
    onSuccess: (me) => {
      qc.setQueryData(qk.me(), me);
      const s = useSessionStore.getState();
      if (s.deviceId) s.setAuthed(toSessionUser(me), s.deviceId, s.accessToken);
    },
  });
}

export function requestDeletion(password: string): Promise<DeletionStatusDto> {
  return api<DeletionStatusDto>('/v1/me/deletion', { method: 'POST', body: { password } });
}

export function cancelDeletion(): Promise<void> {
  return api('/v1/me/deletion', { method: 'DELETE' });
}

/** Devices (S-31), cached by TanStack Query. */
export function useDevices() {
  const authed = useSessionStore((s) => s.status === 'authed');
  return useQuery({
    queryKey: qk.devices(),
    queryFn: async () => (await api<{ items: DeviceDto[] }>('/v1/devices')).items,
    enabled: authed,
  });
}

/** Revokes a device optimistically; the list rolls back if the server refuses. */
export function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/v1/devices/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.devices() });
      const before = qc.getQueryData<DeviceDto[]>(qk.devices());
      qc.setQueryData<DeviceDto[]>(qk.devices(), (list) => list?.filter((d) => d.id !== id));
      return { before };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.before) qc.setQueryData(qk.devices(), ctx.before);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.devices() }),
  });
}

export function useRenameDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api<DeviceDto>(`/v1/devices/${id}`, { method: 'PATCH', body: { name } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.devices() }),
  });
}
