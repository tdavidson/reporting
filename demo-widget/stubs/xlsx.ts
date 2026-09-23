/**
 * `xlsx` for the widget bundle. The bank page imports it on demand to parse an uploaded
 * spreadsheet; the demo refuses uploads, so the half-megabyte parser never runs and is not
 * shipped. Anything that reaches for it gets a clear error instead of a silent nothing.
 */
const unavailable = () => { throw new Error('Spreadsheet import is not available in the demo.') }
export const read = unavailable
export const readFile = unavailable
export const write = unavailable
export const writeFile = unavailable
export const utils = new Proxy({}, { get: () => unavailable })
export default { read, readFile, write, writeFile, utils }
