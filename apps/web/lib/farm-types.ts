export const FARM_TYPES = ['broiler', 'layer', 'hatchery', 'breeder'] as const;
export type FarmType = (typeof FARM_TYPES)[number];

export const FARM_TYPE_INFO: Record<FarmType, { label: string; te: string; blurb: string }> = {
  broiler: { label: 'Broiler', te: 'బ్రాయిలర్', blurb: 'Chicken growth · weight, FCR, lifting to shops' },
  layer: { label: 'Layer', te: 'లేయర్', blurb: 'Eggs laid per day · supply per day' },
  hatchery: { label: 'Hatchery', te: 'హాచరీ', blurb: 'Eggs set · hatch · chicks dispatched' },
  breeder: { label: 'Breeder', te: 'బ్రీడర్', blurb: 'Parent flock · hatching eggs' },
};

/** Types the picker offers: what the tenant runs, or the three core types for a brand-new tenant. */
export const pickerOptions = (tenantTypes: FarmType[]): FarmType[] =>
  tenantTypes.length ? FARM_TYPES.filter((t) => tenantTypes.includes(t)) : ['broiler', 'layer', 'hatchery'];
