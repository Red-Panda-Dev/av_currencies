export type Env = {
  VIN_DATA: KVNamespace;
  IDENTITY_SALT: { get: () => Promise<string> };
  ALLOWED_ORIGINS?: string;
};

export type VinRecord = {
  pageId: string;
  pageUrl: string;
  vin: string;
  createdAt: string;
  updatedAt: string;
  firstSeenAt: string;
  lastSeenAt: string;
  confirmations: number;
  readConfirmations: number;
  writeConfirmations: number;
  submissionCount: number;
  submittedByHash: string;
  confirmedByHashes: string[];
  readConfirmedByHashes: string[];
  schemaVersion: 1;
};

export type VinResponse = {
  exists: boolean;
  pageId: string;
  vin?: string;
  confirmations?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
};
