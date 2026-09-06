import type { JSONSchema7 } from "@ai-sdk/provider"
import { JsonSchema, Schema } from "effect"
import type * as Tool from "./tool"

type JsonObject = Record<string, unknown>
const cache = new WeakMap<Schema.Top, JSONSchema7>()

export function fromSchema(schema: Schema.Top): JSONSchema7 {
  const cached = cache.get(schema)
  if (cached) return cached

  const document = Schema.toJsonSchemaDocument(schema, { additionalProperties: true })
  const result = normalize({
    $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
    ...document.schema,
    ...(Object.keys(document.definitions).length > 0 ? { $defs: document.definitions } : {}),
  })
  const inlined = dropDefinitionsIfResolved(inlineLocalReferences(result))
  if (!isJsonSchema(inlined)) throw new Error("tool JSON Schema helper produced a non-schema value")
  cache.set(schema, inlined)
  return inlined
}

export function fromTool(tool: Tool.Def): JSONSchema7 {
  return tool.jsonSchema ?? fromSchema(tool.parameters as Schema.Top)
}

function normalize(value: unknown, options: { stripNull?: boolean } = {}): unknown {
  if (Array.isArray(value)) return value.map((item) => normalize(item))
  if (!isRecord(value)) return value

  const schema = normalizeChildren(value)
  if (schema.additionalProperties === true) delete schema.additionalProperties

  const rewritten = collapseAnyOf(schema, options.stripNull === true) ?? flattenAllOf(schema)
  if (rewritten) return normalize(rewritten)

  return boundIntegerRange(schema)
}

function normalizeChildren(value: JsonObject): JsonObject {
  const required = Array.isArray(value.required)
    ? new Set(value.required.filter((item) => typeof item === "string"))
    : undefined
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "properties" && isRecord(item)
        ? Object.fromEntries(
            Object.entries(item).map(([name, property]) => [
              name,
              normalize(property, { stripNull: !required?.has(name) }),
            ]),
          )
        : normalize(item),
    ]),
  )
}

// Returns a replacement schema when the `anyOf` union can be simplified, or
// undefined to leave the schema untouched. Each rewrite is re-normalized by the caller.
function collapseAnyOf(schema: JsonObject, stripNull: boolean): JsonObject | undefined {
  if (!Array.isArray(schema.anyOf)) return
  const items: unknown[] = schema.anyOf

  const withoutNull = stripNull ? items.filter((item) => !isRecord(item) || item.type !== "null") : items
  if (withoutNull.length !== items.length) return { ...schema, anyOf: withoutNull }

  const { anyOf: _, ...rest } = schema
  const number = items.find((item) => isRecord(item) && item.type === "number")
  if (isRecord(number) && items.filter(isNonFiniteEnum).length === items.length - 1) return { ...number, ...rest }
  if (isEmptyStructUnion(items)) return { type: "object", properties: {}, ...rest }
  if (items.length === 1 && isRecord(items[0])) return { ...items[0], ...rest }
}

function flattenAllOf(schema: JsonObject): JsonObject | undefined {
  if (!Array.isArray(schema.allOf)) return
  const items: unknown[] = schema.allOf
  if (!items.every(isRecord) || !canFlattenAllOf(items, schema)) return
  const { allOf: _, ...rest } = schema
  return { ...Object.assign({}, ...items), ...rest }
}

function boundIntegerRange(schema: JsonObject): JsonObject {
  if (schema.type !== "integer" || schema.maximum !== undefined) return schema
  return { minimum: Number.MIN_SAFE_INTEGER, ...schema, maximum: Number.MAX_SAFE_INTEGER }
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isJsonSchema(value: unknown): value is JSONSchema7 {
  return typeof value === "boolean" || isRecord(value)
}

function isNonFiniteNumber(value: unknown) {
  return value === "NaN" || value === "Infinity" || value === "-Infinity"
}

function isNonFiniteEnum(value: unknown) {
  return isRecord(value) && Array.isArray(value.enum) && value.enum.every(isNonFiniteNumber)
}

function isEmptyStructUnion(items: unknown[]) {
  return (
    items.length === 2 &&
    items.some((item) => isRecord(item) && item.type === "object" && item.properties === undefined) &&
    items.some((item) => isRecord(item) && item.type === "array" && item.items === undefined)
  )
}

function canFlattenAllOf(allOf: JsonObject[], parent: JsonObject) {
  const keys = new Set(Object.keys(parent).filter((key) => key !== "allOf"))
  return allOf.every((item) =>
    Object.keys(item).every((key) => {
      if (keys.has(key)) return false
      keys.add(key)
      return true
    }),
  )
}

function inlineLocalReferences(value: unknown, definitions?: JsonObject, seen = new Set<string>()): unknown {
  if (Array.isArray(value)) return value.map((item) => inlineLocalReferences(item, definitions, seen))
  if (!isRecord(value)) return value

  const localDefinitions = definitions ?? (isRecord(value.$defs) ? value.$defs : undefined)
  if (typeof value.$ref === "string" && localDefinitions) {
    const name = value.$ref.match(/^#\/\$defs\/(.+)$/)?.[1] ?? value.$ref.match(/^#\/definitions\/(.+)$/)?.[1]
    if (name && !seen.has(name)) {
      const target = localDefinitions[name]
      if (target) {
        const { $ref: _, ...rest } = value
        return inlineLocalReferences(
          { ...(isRecord(target) ? target : {}), ...rest },
          localDefinitions,
          new Set(seen).add(name),
        )
      }
    }
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, inlineLocalReferences(item, localDefinitions, seen)]),
  )
}

function dropDefinitionsIfResolved(value: unknown): unknown {
  if (!isRecord(value) || hasLocalReference(value)) return value
  const { $defs: _, definitions: __, ...rest } = value
  return rest
}

function hasLocalReference(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasLocalReference)
  if (!isRecord(value)) return false
  if (
    typeof value.$ref === "string" &&
    (value.$ref.startsWith("#/$defs/") || value.$ref.startsWith("#/definitions/"))
  ) {
    return true
  }
  return Object.values(value).some(hasLocalReference)
}

export * as ToolJsonSchema from "./json-schema"
