type JsonSchema = Record<string, unknown>;

export type JsonSchemaContractValidation = {
  errors: string[];
  valid: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const schemaTypeMatches = (value: unknown, type: string): boolean => {
  if (type === "array") {
    return Array.isArray(value);
  }

  if (type === "integer") {
    return Number.isInteger(value);
  }

  if (type === "null") {
    return value === null;
  }

  if (type === "object") {
    return isObject(value);
  }

  return typeof value === type;
};

const formatPath = (path: string): string => path || "$";

const validate = (value: unknown, schema: JsonSchema, path: string): string[] => {
  const errors: string[] = [];

  if (Array.isArray(schema.anyOf)) {
    const matched = schema.anyOf.some(
      (candidate) => isObject(candidate) && validate(value, candidate, path).length === 0
    );
    return matched ? [] : [`${formatPath(path)} does not match any allowed schema.`];
  }

  if (Array.isArray(schema.oneOf)) {
    const matchCount = schema.oneOf.filter(
      (candidate) => isObject(candidate) && validate(value, candidate, path).length === 0
    ).length;
    return matchCount === 1
      ? []
      : [`${formatPath(path)} must match exactly one allowed schema.`];
  }

  if (typeof schema.type === "string" && !schemaTypeMatches(value, schema.type)) {
    return [`${formatPath(path)} must be ${schema.type}.`];
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => candidate === value)) {
    errors.push(`${formatPath(path)} must be one of ${schema.enum.map(String).join(", ")}.`);
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${formatPath(path)} must contain at least ${schema.minLength} characters.`);
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${formatPath(path)} must be at least ${schema.minimum}.`);
    }
  }

  if (Array.isArray(value) && isObject(schema.items)) {
    value.forEach((item, index) => {
      errors.push(...validate(item, schema.items as JsonSchema, `${path}[${index}]`));
    });
  }

  if (isObject(value)) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === "string")
      : [];

    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(`${formatPath(path)}.${key} is required.`);
      }
    }

    for (const [key, propertyValue] of Object.entries(value)) {
      const propertySchema = properties[key];
      if (isObject(propertySchema)) {
        errors.push(...validate(propertyValue, propertySchema, `${formatPath(path)}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${formatPath(path)}.${key} is not allowed.`);
      }
    }
  }

  return errors;
};

export const validateJsonSchemaContract = (
  value: unknown,
  schema: JsonSchema | null
): JsonSchemaContractValidation => {
  if (!schema) {
    return { errors: [], valid: true };
  }

  const errors = validate(value, schema, "$");
  return {
    errors,
    valid: errors.length === 0
  };
};
