// ============================================================================
// lite-json-schema.ts — 零依赖 JSON Schema 子集校验器（t2 v3，plan e6a3c9f4）
// ----------------------------------------------------------------------------
// 动机（codex 高优4）：check-receipt slim 对 summary 只查 required 键，错误类型/
// 非法嵌套/额外字段仍可通过。本仓无 ajv 依赖，实现 summary.schema.json 实际用到的
// 关键字子集：type / enum / const / required / properties / items /
// additionalProperties / pattern / minLength / minimum / $ref(#/$defs/*)。
// 语义取"拒绝可疑"方向：未知关键字忽略（与 JSON Schema 一致），已支持关键字严格执行。
// ============================================================================

export interface LiteSchemaViolation {
  path: string;
  message: string;
}

type Schema = Record<string, unknown>;

/**
 * v4（codex 高优）：own-property 判定必须走 hasOwnProperty——`key in obj` 会查原型链，
 * constructor/toString/__proto__ 等键可伪装成"schema 已声明"逃过 additionalProperties，
 * 或伪装成"字段已存在"逃过 required（实测 {constructor:1} 曾通过 additionalProperties:false）。
 */
function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
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

export function validateLiteSchema(
  value: unknown,
  schema: Schema,
  rootSchema?: Schema,
  atPath = '$',
): LiteSchemaViolation[] {
  const root = rootSchema ?? schema;
  const out: LiteSchemaViolation[] = [];

  // $ref 解引用（仅支持 #/$defs/<name>）
  const ref = schema.$ref;
  if (typeof ref === 'string') {
    const m = ref.match(/^#\/\$defs\/([\w-]+)$/);
    const defs = (root.$defs ?? {}) as Record<string, Schema>;
    const target = m ? defs[m[1]] : undefined;
    if (!target) {
      out.push({ path: atPath, message: `无法解析 $ref：${ref}` });
      return out;
    }
    return validateLiteSchema(value, target, root, atPath);
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

  if (schema.const !== undefined && value !== schema.const) {
    out.push({ path: atPath, message: `const 不符：期望 ${JSON.stringify(schema.const)}` });
  }
  if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).includes(value)) {
    out.push({ path: atPath, message: `enum 不符：${JSON.stringify(value)} 不在 ${JSON.stringify(schema.enum)}` });
  }
  if (typeof value === 'string') {
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      out.push({ path: atPath, message: `pattern 不符：${schema.pattern}` });
    }
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      out.push({ path: atPath, message: `minLength 不符：须 ≥${schema.minLength}` });
    }
  }
  if (typeof value === 'number' && typeof schema.minimum === 'number' && value < schema.minimum) {
    out.push({ path: atPath, message: `minimum 不符：须 ≥${schema.minimum}` });
  }

  if (Array.isArray(value) && schema.items && typeof schema.items === 'object') {
    value.forEach((item, i) => {
      out.push(...validateLiteSchema(item, schema.items as Schema, root, `${atPath}[${i}]`));
    });
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
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
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!hasOwn(props, key)) {
          out.push({ path: `${atPath}.${key}`, message: '额外字段（additionalProperties: false）' });
        }
      }
    }
  }
  return out;
}
