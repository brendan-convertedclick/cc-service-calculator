export type TaskType = "external" | "internal";

export interface DeliveryMemberStats {
  userId: number;
  externalCompleted: number;
  externalCreated: number;
  externalRate: number;
  internalCompleted: number;
  internalCreated: number;
  internalRate: number;
  tasksCompletedInPeriod: number;
  avgCycleDays: number;
  tasksPerWorkingDay: number;
  totalValueZar: number;
  humanHours: number;
  yieldPerHour: number;
}

export interface DeliveryBucketMember {
  userId: number;
  externalCompleted: number;
  internalCompleted: number;
  valueZar: number;
  avgCycleDays: number;
}

export interface DeliveryBucket {
  bucket: string;
  members: DeliveryBucketMember[];
}

export interface DeliveryMeta {
  periodLabel: string;
  workingDays: number;
  overallExternalRate: number;
  overallInternalRate: number;
  avgCycleDays: number;
  tasksPerWorkingDay: number;
  totalValueZar: number;
  avgYieldPerHour: number;
  zarPerPoint: number;
}

export interface DeliveryData {
  meta: DeliveryMeta;
  members: DeliveryMemberStats[];
  buckets: DeliveryBucket[];
}
