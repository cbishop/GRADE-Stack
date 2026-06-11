// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

export interface SupportEmail {
  from: string;
  subject: string;
  body: string;
}

/** A representative inbound support email, used as the default triage input. */
export const SAMPLE_EMAIL: SupportEmail = {
  from: "dana@acme-retail.example",
  subject: "Charged twice for my June invoice",
  body: [
    "Hi — I just noticed two identical charges of $480 on my card for the June",
    "subscription invoice (#INV-20418). I only have one active plan, so one of",
    "these must be a mistake. Can you refund the duplicate today? I need this",
    "sorted before our finance close on Friday. Getting a bit frustrated as this",
    "is the second billing issue this quarter.",
    "",
    "Thanks,",
    "Dana",
  ].join("\n"),
};
