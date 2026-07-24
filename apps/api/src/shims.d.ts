declare module "cookie";
declare module "mmsi-country-lookup" {
  export type MmsiCountryResult = {
    mmsi: string;
    mid: string | null;
    alpha2: string | null;
    alpha3: string | null;
    country: string | null;
    valid: boolean;
    type: string | null;
  };

  export function getCountryFromMMSI(mmsi: string | number): MmsiCountryResult;
}
