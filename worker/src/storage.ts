import type { Env, VinRecord, VinResponse } from "./types";

const MAX_CONFIRMER_HASHES = 50;

function boundHashes(items: string[]): string[] {
  if (items.length <= MAX_CONFIRMER_HASHES) return items;
  return items.slice(items.length - MAX_CONFIRMER_HASHES);
}

export function toVinResponse(record: VinRecord): VinResponse {
  return {
    exists: true,
    pageId: record.pageId,
    vin: record.vin,
    confirmations: record.confirmations,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
  };
}

export async function getRecord(
  env: Env,
  pageId: string,
): Promise<VinRecord | null> {
  return env.VIN_DATA.get(`vin:${pageId}`, "json");
}

export async function putRecord(env: Env, record: VinRecord): Promise<void> {
  await env.VIN_DATA.put(`vin:${record.pageId}`, JSON.stringify(record));
}

export function createRecord(input: {
  pageId: string;
  pageUrl: string;
  vin: string;
  identityHash: string;
  nowIso: string;
}): VinRecord {
  return {
    pageId: input.pageId,
    pageUrl: input.pageUrl,
    vin: input.vin,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
    firstSeenAt: input.nowIso,
    lastSeenAt: input.nowIso,
    confirmations: 1,
    readConfirmations: 0,
    writeConfirmations: 1,
    submissionCount: 1,
    submittedByHash: input.identityHash,
    confirmedByHashes: [input.identityHash],
    readConfirmedByHashes: [],
    schemaVersion: 1,
  };
}

export function confirmRead(
  record: VinRecord,
  identityHash: string,
  nowIso: string,
): VinRecord {
  if (record.readConfirmedByHashes.includes(identityHash)) {
    return { ...record, lastSeenAt: nowIso };
  }
  const readConfirmedByHashes = boundHashes([
    ...record.readConfirmedByHashes,
    identityHash,
  ]);
  return {
    ...record,
    updatedAt: nowIso,
    lastSeenAt: nowIso,
    readConfirmedByHashes,
    readConfirmations: record.readConfirmations + 1,
    confirmations: record.confirmations + 1,
  };
}

export function confirmWrite(
  record: VinRecord,
  identityHash: string,
  nowIso: string,
): VinRecord {
  const alreadyConfirmed = record.confirmedByHashes.includes(identityHash);
  const confirmedByHashes = alreadyConfirmed
    ? record.confirmedByHashes
    : boundHashes([...record.confirmedByHashes, identityHash]);

  return {
    ...record,
    updatedAt: nowIso,
    lastSeenAt: nowIso,
    confirmedByHashes,
    submissionCount: record.submissionCount + 1,
    writeConfirmations: alreadyConfirmed
      ? record.writeConfirmations
      : record.writeConfirmations + 1,
    confirmations: alreadyConfirmed
      ? record.confirmations
      : record.confirmations + 1,
  };
}
