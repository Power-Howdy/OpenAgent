/**
 * HTTP utility constants and helpers
 */

// WARNING: We rely on `OpenAgent-cli` in the user agent for log filtering.
// Please do NOT change this without making sure that logging also gets updated!
export const USER_AGENT = `OpenAgent-cli/${MACRO.VERSION} (${process.env.USER_TYPE})`
