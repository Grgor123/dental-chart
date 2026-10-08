// Business premise registration (prijava poslovnega prostora) — every fiscal
// invoice names a premise (P1) that must first be registered with FURS.
// Endpoint: POST {base}/invoices/register, body {"token": <JWS>}.
import { fursPost } from './client.ts';
import { decodeFursJws, fursDateTime, signFursJws } from './jws.ts';

export interface FursPremise {
  /** Our label, e.g. "P1" — the same one invoice numbers start with. */
  premiseId: string;
  /** Katastrska občina (number), številka stavbe, številka dela stavbe. */
  cadastralNumber: number;
  buildingNumber: number;
  buildingSectionNumber: number;
  street: string;
  houseNumber: string;
  houseNumberAdditional?: string;
  community: string;
  city: string;
  postalCode: string;
  /** YYYY-MM-DD */
  validityDate: string;
  /** Set to 'Z' to close the premise. */
  closingTag?: 'Z';
}

export interface FursResult {
  ok: boolean;
  /** FURS's error code and message, when it refused. */
  errorCode?: string;
  errorMessage?: string;
  /** The decoded answer, for logging. */
  response: unknown;
}

export async function registerPremise(taxNumber: number, premise: FursPremise, softwareSupplierTaxNumber: number): Promise<FursResult> {
  const address: Record<string, string> = {
    Street: premise.street,
    HouseNumber: premise.houseNumber,
    Community: premise.community,
    City: premise.city,
    PostalCode: premise.postalCode,
  };
  if (premise.houseNumberAdditional) address.HouseNumberAdditional = premise.houseNumberAdditional;

  const payload = {
    BusinessPremiseRequest: {
      Header: { MessageID: crypto.randomUUID(), DateTime: fursDateTime() },
      BusinessPremise: {
        TaxNumber: taxNumber,
        BusinessPremiseID: premise.premiseId,
        BPIdentifier: {
          RealEstateBP: {
            PropertyID: {
              CadastralNumber: premise.cadastralNumber,
              BuildingNumber: premise.buildingNumber,
              BuildingSectionNumber: premise.buildingSectionNumber,
            },
            Address: address,
          },
        },
        ValidityDate: premise.validityDate,
        ...(premise.closingTag ? { ClosingTag: premise.closingTag } : {}),
        SoftwareSupplier: [{ TaxNumber: softwareSupplierTaxNumber }],
      },
    },
  };

  const { status, json, text } = await fursPost('invoices/register', { token: await signFursJws(payload) });
  const token = (json as { token?: string } | null)?.token;
  if (!token) return { ok: false, errorMessage: `FURS HTTP ${status}: ${text.slice(0, 300)}`, response: json ?? text };
  const response = decodeFursJws(token) as { BusinessPremiseResponse?: { Error?: { ErrorCode?: string; ErrorMessage?: string } } };
  const error = response.BusinessPremiseResponse?.Error;
  return error ? { ok: false, errorCode: error.ErrorCode, errorMessage: error.ErrorMessage, response } : { ok: true, response };
}
