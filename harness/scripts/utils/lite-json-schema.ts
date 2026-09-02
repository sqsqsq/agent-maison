// ============================================================================
// lite-json-schema.ts — 零依赖 JSON Schema 子集校验器（t2 v3，plan e6a3c9f4）
// ----------------------------------------------------------------------------
// 动机（codex 高优4）：check-receipt slim 对 summary 只查 required 键，错误类型/
// 非法嵌套/额外字段仍可通过。本仓无 ajv 依赖，实现 summary.schema.json 实际用到的
// 关键字子集：type / enum / const / required / properties / items /
// additionalProperties / pattern / minLength / minimum / $ref(#/$defs/*)。
//
// v5（plan a6c4e9f2 T4 返修）：本文件原来的"未知关键字忽略"是 **fail-open**——
// 拿它去校验 Hylyre 冻结 `output-schema.json` 时，`allOf/anyOf/oneOf/not/if-then/
// contains/propertyNames/minItems` 这些**约束会被整条跳过**，非法 trace 照样判过。
// 用作 required gate 的校验器时这等同于没有校验。两项改动：
//   1. 补齐组合关键字（allOf/anyOf/oneOf/not/if-then-else）、propertyNames、contains、
//      minItems/maxItems/maxLength/maximum/exclusive*/uniqueItems、
//      additionalProperties 作为 schema、$ref 到 `#`；
//   2. 新增 `auditSchemaSupport()`：**加载期静态遍历整份 schema**，遇到本实现未覆盖
//      的关键字直接报错。调用方必须在使用前审计并 fail-closed，
//      这样"schema 演进引入新关键字"只会变成显式拒绝，不会变成静默放行。
// 语义方向不变：已支持关键字严格执行。
// ============================================================================

export interface LiteSchemaViolation {
  path: string;
  message: string;
}

type Schema = Record<string, unknown>;

/** 参与判定的关键字——本实现逐条执行。 */
const SUPPORTED_KEYWORDS = new Set([
  '$ref', '$defs',
  'type', 'const', 'enum',
  'properties', 'required', 'additionalProperties', 'propertyNames',
  'items', 'minItems', 'maxItems', 'contains', 'uniqueItems',
  'pattern', 'minLength', 'maxLength',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
]);

/** 纯注解，不影响判定，忽略是安全的。 */
const ANNOTATION_KEYWORDS = new Set([
  '$schema', '$id', '$comment', '$anchor',
  'title', 'description', 'examples', 'default', 'deprecated',
  'readOnly', 'writeOnly',
]);

/**
 * v4（codex 高优）：own-property 判定必须走 hasOwnProperty——`key in obj` 会查原型链，
 * constructor/toString/__proto__ 等键可伪装成"schema 已声明"逃过 additionalProperties，
 * 或伪装成"字段已存在"逃过 required（实测 {constructor:1} 曾通过 additionalProperties:false）。
 */
function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isSchemaObject(v: unknown): v is Schema {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v));
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(declared: string, actual: string): boolean {
  if (declared === actual) return true;
  if (declared === 'number' && actual === 'integer') return true;
  return false;
}

// ---------------------------------------------------------------------------
// 加载期静态审计：未覆盖的关键字 → 显式失败，绝不静默放行
// ---------------------------------------------------------------------------

export interface SchemaSupportIssue {
  /** schema 内部位置，如 `#/$defs/stepResultV1/properties/outcome` */
  pointer: string;
  keyword: string;
}

/**
 * 静态遍历整份 schema，收集本实现**未覆盖**的关键字。
 *
 * 之所以要静态走全树、而不是只在校验时顺路查：分支未被实例走到时，运行期
 * 永远看不到那条分支上的未知关键字，于是"没报错"会被误读成"约束都执行了"。
 * 加载期一次性审计能把这种沉默变成显式失败。
 */
export function auditSchemaSupport(schema: unknown, pointer = '#'): SchemaSupportIssue[] {
  const out: SchemaSupportIssue[] = [];
  if (Array.isArray(schema)) {
    schema.forEach((item, i) => out.push(...auditSchemaSupport(item, `${pointer}/${i}`)));
    return out;
  }
  if (!isSchemaObject(schema)) return out;

  for (const key of Object.keys(schema)) {
    if (ANNOTATION_KEYWORDS.has(key)) continue;
    if (!SUPPORTED_KEYWORDS.has(key)) {
      out.push({ pointer, keyword: key });
      continue;
    }
    const value = schema[key];
    // 这些关键字的值是「名字 → 子 schema」的映射，键名不是关键字。
    if (key === 'properties' || key === '$defs') {
      if (isSchemaObject(value)) {
        for (const [name, sub] of Object.entries(value)) {
          out.push(...auditSchemaSupport(sub, `${pointer}/${key}/${name}`));
        }
      }
      continue;
    }
    // 这些关键字的值是标量约束，没有子 schema。
    if (key === 'required' || key === 'enum' || key === 'const' || key === 'type') continue;
    out.push(...auditSchemaSupport(value, `${pointer}/${key}`));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

function resolveRef(ref: string, root: Schema, atPath: string): { schema: Schema } | { error: LiteSchemaViolation } {
  if (ref === '#') return { schema: root };
  const m = ref.match(/^#\/\$defs\/([\w-]+)$/);
  const defs = (root.$defs ?? {}) as Record<string, Schema>;
  const target = m ? defs[m[1]] : undefined;
  if (!target) return { error: { path: atPath, message: `无法解析 $ref：${ref}` } };
  return { schema: target };
}

export function validateLiteSchema(
  value: unknown,
  schema: Schema,
  rootSchema?: Schema,
  atPath = '$',
): LiteSchemaViolation[] {
  const root = rootSchema ?? schema;
  const out: LiteSchemaViolation[] = [];

  // $ref 解引用（支持 `#` 与 `#/$defs/<name>`）
  const ref = schema.$ref;
  if (typeof ref === 'string') {
    const resolved = resolveRef(ref, root, atPath);
    if ('error' in resolved) return [resolved.error];
    return validateLiteSchema(value, resolved.schema, root, atPath);
  }

  const declaredType = schema.type;
  if (declaredType !== undefined) {
    const actual = typeOf(value);
    const declared = Array.isArray(declaredType) ? (declaredType as string[]) : [String(declaredType)];
    if (!declared.some(d => typeMatches(d, actual))) {
      out.push({ path: atPath, message: `类型不符：期望 ${declared.join('|')}，实际 ${actual}` });
      return out; // 类型错，后续结构检查无意义
    }
  }

  if (hasOwn(schema, 'const') && value !== schema.const) {
    out.push({ path: atPath, message: `const 不符：期望 ${JSON.stringify(schema.const)}` });
  }
  if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).includes(value)) {
    out.push({ path: atPath, message: `enum 不符：${JSON.stringify(value)} 不在 ${JSON.stringify(schema.enum)}` });
  }

  if (typeof value === 'string') {
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
      out.push({ path: atPath, message: `pattern 不符：${schema.pattern}` });
    }
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      out.push({ path: atPath, message: `minLength 不符：须 ≥${schema.minLength}` });
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      out.push({ path: atPath, message: `maxLength 不符：须 ≤${schema.maxLength}` });
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      out.push({ path: atPath, message: `minimum 不符：须 ≥${schema.minimum}` });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      out.push({ path: atPath, message: `maximum 不符：须 ≤${schema.maximum}` });
    }
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
      out.push({ path: atPath, message: `exclusiveMinimum 不符：须 >${schema.exclusiveMinimum}` });
    }
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
      out.push({ path: atPath, message: `exclusiveMaximum 不符：须 <${schema.exclusiveMaximum}` });
    }
    if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
      const q = value / schema.multipleOf;
      if (Math.abs(q - Math.round(q)) > 1e-9) {
        out.push({ path: atPath, message: `multipleOf 不符：须为 ${schema.multipleOf} 的整数倍` });
      }
    }
  }

  if (Array.isArray(value)) {
    if (isSchemaObject(schema.items)) {
      value.forEach((item, i) => {
        out.push(...validateLiteSchema(item, schema.items as Schema, root, `${atPath}[${i}]`));
      });
    }
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      out.push({ path: atPath, message: `minItems 不符：须 ≥${schema.minItems} 项，实际 ${value.length}` });
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      out.push({ path: atPath, message: `maxItems 不符：须 ≤${schema.maxItems} 项，实际 ${value.length}` });
    }
    if (isSchemaObject(schema.contains)) {
      const hit = value.some(
        item => validateLiteSchema(item, schema.contains as Schema, root, atPath).length === 0,
      );
      if (!hit) out.push({ path: atPath, message: 'contains 不符：没有任何一项满足 contains 子 schema' });
    }
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map(v => JSON.stringify(v)));
      if (seen.size !== value.length) out.push({ path: atPath, message: 'uniqueItems 不符：存在重复项' });
    }
  }

  if (isSchemaObject(value)) {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    const required = (schema.required ?? []) as string[];
    for (const key of required) {
      if (!hasOwn(obj, key) || obj[key] === undefined) {
        out.push({ path: `${atPath}.${key}`, message: '缺必填字段' });
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (hasOwn(obj, key) && obj[key] !== undefined) {
        out.push(...validateLiteSchema(obj[key], sub, root, `${atPath}.${key}`));
      }
    }
    if (hasOwn(schema, 'additionalProperties') && schema.additionalProperties !== true) {
      for (const key of Object.keys(obj)) {
        if (hasOwn(props, key)) continue;
        // `undefined` 不是 JSON 值：JS 侧的投影对象常把"没有这个字段"写成
        // `key: undefined`（如 parseHylyreTrace 的 runtime_step_telemetry），
        // 按 Object.keys 它是自有键，但语义上就是缺席。required 分支已按缺席处理，
        // 这里必须同口径，否则同一个字段会被判成"既缺失又多余"。
        if (obj[key] === undefined) continue;
        if (schema.additionalProperties === false) {
          out.push({ path: `${atPath}.${key}`, message: '额外字段（additionalProperties: false）' });
        } else if (isSchemaObject(schema.additionalProperties)) {
          out.push(
            ...validateLiteSchema(obj[key], schema.additionalProperties as Schema, root, `${atPath}.${key}`),
          );
        }
      }
    }
    if (isSchemaObject(schema.propertyNames)) {
      for (const key of Object.keys(obj)) {
        if (obj[key] === undefined) continue;
        const v = validateLiteSchema(key, schema.propertyNames as Schema, root, `${atPath}.${key}`);
        if (v.length > 0) {
          out.push({ path: `${atPath}.${key}`, message: `propertyNames 不符：${v[0].message}` });
        }
      }
    }
  }

  // ── 组合关键字 ───────────────────────────────────────────────────
  // 这些原本被整条忽略，是本文件此前最危险的 fail-open 面。
  if (Array.isArray(schema.allOf)) {
    (schema.allOf as Schema[]).forEach((sub, i) => {
      out.push(...validateLiteSchema(value, sub, root, atPath).map(v => ({
        path: v.path,
        message: `allOf[${i}]：${v.message}`,
      })));
    });
  }
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf as Schema[];
    const results = branches.map(sub => validateLiteSchema(value, sub, root, atPath));
    if (!results.some(r => r.length === 0)) {
      out.push({
        path: atPath,
        message: `anyOf 不符：${branches.length} 个分支都不满足（首支：${results[0]?.[0]?.message ?? '无细节'}）`,
      });
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const branches = schema.oneOf as Schema[];
    const passed = branches.filter(sub => validateLiteSchema(value, sub, root, atPath).length === 0).length;
    if (passed !== 1) {
      out.push({ path: atPath, message: `oneOf 不符：恰好应满足 1 个分支，实际满足 ${passed} 个` });
    }
  }
  if (isSchemaObject(schema.not)) {
    if (validateLiteSchema(value, schema.not as Schema, root, atPath).length === 0) {
      out.push({ path: atPath, message: 'not 不符：值满足了被禁止的子 schema' });
    }
  }
  if (isSchemaObject(schema.if)) {
    const condOk = validateLiteSchema(value, schema.if as Schema, root, atPath).length === 0;
    const branch = condOk ? schema.then : schema.else;
    if (isSchemaObject(branch)) {
      out.push(...validateLiteSchema(value, branch as Schema, root, atPath).map(v => ({
        path: v.path,
        message: `${condOk ? 'then' : 'else'}：${v.message}`,
      })));
    }
  }

  return out;
}
