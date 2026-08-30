export const FREE_MONTHLY_LIMIT = 2000;

export function isWithinFreeQuota(used: number) {
  return used < FREE_MONTHLY_LIMIT;
}