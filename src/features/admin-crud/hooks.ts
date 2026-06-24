import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  FacilityRelationsResponse,
  FacilityRelationsUpsertRequest,
  ImportResponse,
  OptionsResponse,
  RecordsResponse,
  SchemaResponse
} from "../../../shared/types";
import { apiRequest } from "../../lib/api";

export const adminCrudQueryKeys = {
  schema: ["admin-crud", "schema"] as const,
  records: (tableName: string, page: number, pageSize: number, search: string) =>
    ["admin-crud", "records", tableName, page, pageSize, search] as const,
  options: (tableName: string, search = "", variant = "", ids = "") =>
    ["admin-crud", "options", tableName, search, variant, ids] as const,
  facilityRelations: (facilityId: string) => ["admin-crud", "facility-relations", facilityId] as const
};

export function useSchemaQuery() {
  return useQuery({
    queryKey: adminCrudQueryKeys.schema,
    queryFn: () => apiRequest<SchemaResponse>("/api/schema")
  });
}

export function useRecordsQuery(
  tableName: string,
  page: number,
  pageSize: number,
  search: string,
  enabled = true
) {
  return useQuery({
    enabled: enabled && Boolean(tableName),
    queryKey: adminCrudQueryKeys.records(tableName, page, pageSize, search),
    queryFn: () =>
      apiRequest<RecordsResponse>(
        `/api/records/${tableName}?limit=${pageSize}&offset=${page * pageSize}&search=${encodeURIComponent(search)}`
      )
  });
}

export function useOptionsQuery({
  enabled = true,
  ids = "",
  limit = 50,
  search = "",
  tableName,
  variant = ""
}: {
  enabled?: boolean;
  ids?: string;
  limit?: number;
  search?: string;
  tableName: string;
  variant?: string;
}) {
  return useQuery({
    enabled: enabled && Boolean(tableName),
    queryKey: adminCrudQueryKeys.options(tableName, search, variant, ids),
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (ids) params.set("ids", ids);
      if (search) params.set("search", search);
      if (variant) params.set("variant", variant);
      return apiRequest<OptionsResponse>(`/api/options/${tableName}?${params.toString()}`);
    }
  });
}

export function useFacilityRelationsQuery(facilityId: string, enabled = true) {
  return useQuery({
    enabled: enabled && Boolean(facilityId),
    queryKey: adminCrudQueryKeys.facilityRelations(facilityId),
    queryFn: () => apiRequest<FacilityRelationsResponse>(`/api/facilities/${facilityId}/relations`)
  });
}

export function useImportRecordsMutation(tableName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rows: Array<Record<string, unknown>>) =>
      apiRequest<ImportResponse>(`/api/import/${tableName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows })
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-crud", "records", tableName] })
  });
}

export function useUpsertFacilityRelationsMutation(facilityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: FacilityRelationsUpsertRequest) =>
      apiRequest<FacilityRelationsResponse>(`/api/facilities/${facilityId}/relations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: adminCrudQueryKeys.facilityRelations(facilityId) })
  });
}
