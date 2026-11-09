export interface Pagination {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  from: number;
  to: number;
}

export function buildPagination(pageInput: number, total: number, perPage: number): Pagination {
  const safePerPage = Math.max(1, Math.floor(perPage));
  const totalPages = Math.max(1, Math.ceil(total / safePerPage));
  const page = Math.min(Math.max(1, Math.floor(pageInput) || 1), totalPages);
  const offset = (page - 1) * safePerPage;

  return {
    page,
    perPage: safePerPage,
    total,
    totalPages,
    from: total === 0 ? 0 : offset + 1,
    to: Math.min(total, offset + safePerPage),
  };
}
