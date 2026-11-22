import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export const useCameras = () =>
  useQuery({ queryKey: ['cameras'], queryFn: api.cameras, refetchInterval: 10_000 })

export const useZones = () =>
  useQuery({ queryKey: ['zones'], queryFn: api.zones, staleTime: 60_000 })

/** params: page, camera, zone, video, code, status, date_from, date_to. Возвращает { count, results }. */
export const useViolations = (params = {}) =>
  useQuery({
    queryKey: ['violations', params],
    queryFn: () => api.violations(params),
    refetchInterval: 5_000,
    placeholderData: keepPreviousData,
  })

export const useViolationCount = (params = {}) =>
  useQuery({
    queryKey: ['violation-count', params],
    queryFn: () => api.violationsCount(params),
    refetchInterval: 15_000,
  })

export const useViolationCounts = (paramsList) =>
  useQueries({
    queries: paramsList.map((params) => ({
      queryKey: ['violation-count', params],
      queryFn: () => api.violationsCount(params),
      refetchInterval: 15_000,
    })),
  })

export const useSummariesSince = (dateFrom) =>
  useQuery({
    queryKey: ['summaries-since', dateFrom],
    queryFn: () => api.summariesSince(dateFrom),
    refetchInterval: 60_000,
  })

export function useSetViolationStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }) => api.setViolationStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['violations'] })
      qc.invalidateQueries({ queryKey: ['violation-count'] })
    },
  })
}

function useInvalidating(mutationFn, keys) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  })
}
export const useSaveCamera = () => useInvalidating(({ id, data }) => api.saveCamera(id, data), ['cameras'])
// удаление камеры каскадно удаляет зоны и нарушения — обновляем всё
export const useDeleteCamera = () =>
  useInvalidating(api.deleteCamera, ['cameras', 'zones', 'violations', 'violation-count'])
export const useSaveZone = () => useInvalidating(({ id, data }) => api.saveZone(id, data), ['zones'])
export const useDeleteZone = () => useInvalidating(api.deleteZone, ['zones'])
export const useSetZoneRule = () => useInvalidating(api.setZoneRule, ['zones'])

// import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
// import { api } from './client'

// export const useCameras = () =>
//   useQuery({ queryKey: ['cameras'], queryFn: api.cameras, refetchInterval: 10_000 })

// export const useZones = () =>
//   useQuery({ queryKey: ['zones'], queryFn: api.zones, staleTime: 60_000 })

// /** params: page, camera, zone, video, code, status, date_from, date_to. Возвращает { count, results }. */
// export const useViolations = (params = {}) =>
//   useQuery({
//     queryKey: ['violations', params],
//     queryFn: () => api.violations(params),
//     refetchInterval: 5_000,
//     placeholderData: keepPreviousData,
//   })

// export const useViolationCount = (params = {}) =>
//   useQuery({
//     queryKey: ['violation-count', params],
//     queryFn: () => api.violationsCount(params),
//     refetchInterval: 15_000,
//   })

// export const useViolationCounts = (paramsList) =>
//   useQueries({
//     queries: paramsList.map((params) => ({
//       queryKey: ['violation-count', params],
//       queryFn: () => api.violationsCount(params),
//       refetchInterval: 15_000,
//     })),
//   })

// export const useSummariesSince = (dateFrom) =>
//   useQuery({
//     queryKey: ['summaries-since', dateFrom],
//     queryFn: () => api.summariesSince(dateFrom),
//     refetchInterval: 60_000,
//   })

// export function useSetViolationStatus() {
//   const qc = useQueryClient()
//   return useMutation({
//     mutationFn: ({ id, status }) => api.setViolationStatus(id, status),
//     onSuccess: () => {
//       qc.invalidateQueries({ queryKey: ['violations'] })
//       qc.invalidateQueries({ queryKey: ['violation-count'] })
//     },
//   })
// }