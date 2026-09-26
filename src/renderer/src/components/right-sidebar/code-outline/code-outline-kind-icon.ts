import {
  Blocks,
  Box,
  Braces,
  Hash,
  ListOrdered,
  SquareFunction,
  Type,
  Variable,
  Wrench,
  Zap,
  type LucideIcon
} from 'lucide-react'
import type { CodeOutlineSymbolKind } from './code-outline-types'

export const CODE_OUTLINE_KIND_ICON: Record<CodeOutlineSymbolKind, LucideIcon> = {
  namespace: Braces,
  class: Box,
  struct: Box,
  record: Box,
  interface: Blocks,
  type: Type,
  enum: ListOrdered,
  'enum-member': Hash,
  function: SquareFunction,
  method: SquareFunction,
  constructor: SquareFunction,
  property: Wrench,
  field: Variable,
  variable: Variable,
  constant: Variable,
  event: Zap
}
