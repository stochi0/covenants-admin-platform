import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApiRecord,
  DashboardMetricsResponse,
  DispatchSendResponse,
  EnquiryImportResponse,
  EnquiryInput,
  ListResponse,
  ProductSearchResponse,
  VendorCandidatesResponse
} from "../../../shared/types";
import { apiRequest } from "../../lib/api";

export const workflowQueryKeys = {
  dashboard: ["workflow", "dashboard"] as const,
  enquiries: (search: string, stage: string) => ["workflow", "enquiries", search, stage] as const,
  enquiry: (id: string) => ["workflow", "enquiry", id] as const,
  dispatches: (status: string) => ["workflow", "dispatches", status] as const,
  products: (search: string) => ["workflow", "products", search] as const,
  vendorCandidates: (itemId: string) => ["workflow", "vendor-candidates", itemId] as const
};

export function useDashboardQuery() {
  return useQuery({
    queryKey: workflowQueryKeys.dashboard,
    queryFn: () => apiRequest<DashboardMetricsResponse>("/api/dashboard")
  });
}

export function useEnquiriesQuery(search: string, stage: string) {
  return useQuery({
    queryKey: workflowQueryKeys.enquiries(search, stage),
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100", offset: "0" });
      if (search.trim()) params.set("search", search.trim());
      if (stage) params.set("stage", stage);
      return apiRequest<ListResponse>(`/api/enquiries?${params.toString()}`);
    }
  });
}

export function useEnquiryQuery(id: string, enabled = true) {
  return useQuery({
    enabled: enabled && Boolean(id),
    queryKey: workflowQueryKeys.enquiry(id),
    queryFn: () => apiRequest<ApiRecord>(`/api/enquiries/${id}`)
  });
}

export function useDispatchesQuery(status: string) {
  return useQuery({
    queryKey: workflowQueryKeys.dispatches(status),
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100", offset: "0" });
      if (status) params.set("status", status);
      return apiRequest<ListResponse>(`/api/enquiry-dispatches?${params.toString()}`);
    }
  });
}

export function useProductSearchQuery(search: string, enabled = true) {
  return useQuery({
    enabled: enabled && search.trim().length >= 2,
    queryKey: workflowQueryKeys.products(search),
    queryFn: () =>
      apiRequest<ProductSearchResponse>(`/api/enquiry-products?search=${encodeURIComponent(search)}`)
  });
}

export function useVendorCandidatesQuery(itemId: string, enabled = true) {
  return useQuery({
    enabled: enabled && Boolean(itemId),
    queryKey: workflowQueryKeys.vendorCandidates(itemId),
    queryFn: () => apiRequest<VendorCandidatesResponse>(`/api/enquiry-items/${itemId}/vendors`),
    placeholderData: keepPreviousData
  });
}

export function useCreateEnquiryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EnquiryInput) =>
      apiRequest<ApiRecord>("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workflow"] })
  });
}

export function useImportEnquiriesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rows: ApiRecord[]) =>
      apiRequest<EnquiryImportResponse>("/api/enquiries/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows })
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workflow"] })
  });
}

export function useSendDispatchesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { enquiryVendorIds: string[]; controlledAcknowledged: boolean }) =>
      apiRequest<DispatchSendResponse>("/api/enquiry-dispatches/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workflow"] })
  });
}
