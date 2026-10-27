import { MACRO } from './build.js'

const target = globalThis as { MACRO?: typeof MACRO }
target.MACRO = MACRO
