export const enquiryConfig = {
  defaultCcEmails: readList(process.env.ENQUIRY_DEFAULT_CC_EMAILS, [
    "alpesh@covenantspc.com",
    "vivek@covenantspc.com",
    "devesh@covenantspc.com"
  ])
};

function readList(value: string | undefined, fallback: string[]) {
  const entries = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return entries && entries.length > 0 ? entries : fallback;
}
