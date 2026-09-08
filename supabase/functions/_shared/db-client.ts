import postgres from "npm:postgres@3.4.4";


export function createDbClient(dbUrl: string, supabaseUrl: string, serviceRoleKey: string) {
  const sql = postgres(dbUrl, {
    max: 1,
    idle_timeout: 3,
    connect_timeout: 10,
    ssl: { rejectUnauthorized: false },
  });

  // Recursively unwrap postgres function results (postgres wraps in { funcname: result })
  function unwrap(rows: unknown[]): unknown {
    if (!rows || rows.length === 0) return null;
    const row = rows[0] as Record<string, unknown>;
    if (!row) return null;
    const keys = Object.keys(row);
    if (keys.length === 1) {
      let val = row[keys[0]];
      if (typeof val === "string") {
        try { val = JSON.parse(val); } catch { /* keep as string */ }
      }
      return val;
    }
    return row;
  }

  function parseJsonbRow(row: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      if (typeof val === "string" && (val.startsWith("{") || val.startsWith("["))) {
        try { result[key] = JSON.parse(val); } catch { result[key] = val; }
      } else {
        result[key] = val;
      }
    }
    return result;
  }

  class QueryBuilder {
    private table: string;
    private _select: string = "*";
    private _where: Array<{ col: string; op: string; val: unknown }> = [];
    private _orderBy: string | null = null;
    private _ascending: boolean = true;
    private _limitN: number | null = null;
    private _single = false;
    private _head = false;
    private _countType: "exact" | null = null;
    private _updateData: Record<string, unknown> | null = null;
    private _insertData: Record<string, unknown> | null = null;
    private _insertRows: Array<Record<string, unknown>> | null = null;
    private _upsertData: Record<string, unknown> | null = null;

    constructor(table: string) {
      this.table = table;
    }

    select(cols: string = "*", opts?: { count?: "exact"; head?: boolean }) {
      this._select = cols;
      if (opts?.count) this._countType = opts.count;
      if (opts?.head) this._head = true;
      return this;
    }

    eq(col: string, val: unknown) {
      this._where.push({ col, op: "=", val });
      return this;
    }

    neq(col: string, val: unknown) {
      this._where.push({ col, op: "!=", val });
      return this;
    }

    gt(col: string, val: unknown) {
      this._where.push({ col, op: ">", val });
      return this;
    }

    gte(col: string, val: unknown) {
      this._where.push({ col, op: ">=", val });
      return this;
    }

    lt(col: string, val: unknown) {
      this._where.push({ col, op: "<", val });
      return this;
    }

    in(col: string, vals: unknown[]) {
      this._where.push({ col, op: "IN", val: vals });
      return this;
    }

    not(col: string, op: string, val: unknown) {
      this._where.push({ col, op: `${op} NOT`, val });
      return this;
    }

    is(col: string, val: unknown) {
      if (val === null) {
        this._where.push({ col, op: "IS NULL", val: null });
      } else {
        this._where.push({ col, op: "IS NOT NULL", val: null });
      }
      return this;
    }

    like(col: string, pattern: string) {
      this._where.push({ col, op: "LIKE", val: pattern });
      return this;
    }

    ilike(col: string, pattern: string) {
      this._where.push({ col, op: "ILIKE", val: pattern });
      return this;
    }

    or(filter: string) {
      // Parse Supabase-style or filter: "col.op.val,col2.op2.val2"
      const parts = filter.split(",");
      const orParts: Array<{ col: string; op: string; val: string }> = [];
      for (const part of parts) {
        const [col, op, ...rest] = part.split(".");
        const val = rest.join(".");
        orParts.push({ col, op, val });
      }
      this._where.push({ col: "__or__", op: "OR", val: orParts });
      return this;
    }

    order(col: string, opts?: { ascending?: boolean }) {
      this._orderBy = col;
      this._ascending = opts?.ascending ?? true;
      return this;
    }

    limit(n: number) {
      this._limitN = n;
      return this;
    }

    maybeSingle() {
      this._single = true;
      return this;
    }

    single() {
      this._single = true;
      return this;
    }

    head(countType?: { count: "exact" }) {
      this._head = true;
      if (countType) this._countType = countType.count;
      return this;
    }

    update(data: Record<string, unknown>) {
      this._updateData = data;
      return this;
    }

    insert(data: Record<string, unknown> | Array<Record<string, unknown>>) {
      if (Array.isArray(data)) {
        this._insertRows = data;
      } else {
        this._insertData = data;
      }
      return this;
    }

    upsert(data: Record<string, unknown>) {
      this._upsertData = data;
      return this;
    }

    async then(resolve: (val: unknown) => unknown, reject?: (err: unknown) => unknown) {
      try {
        const result = await this.execute();
        resolve(result);
      } catch (err) {
        if (reject) reject(err);
      }
    }

    private async execute(): Promise<{ data: unknown; error: { message: string } | null; count?: number }> {
      try {
        // UPDATE
        if (this._updateData) {
          const sets = Object.entries(this._updateData).map(([col, val]) => {
            return sql.unsafe(`${col} = `) + sql`${val}`;
          });
          let query = sql.unsafe(`UPDATE ${this.table} SET `);
          for (let i = 0; i < sets.length; i++) {
            query = query.append(sets[i] as never);
            if (i < sets.length - 1) query = query.append(sql.unsafe(", "));
          }
          query = this.appendWhere(query);
          query = query.append(sql.unsafe(" RETURNING *"));
          const rows = await query;
          const parsedRows = (rows as Array<Record<string, unknown>>).map(r => parseJsonbRow(r));
          return { data: parsedRows, error: null };
        }

        // INSERT
        if (this._insertData || this._insertRows) {
          const rowsToInsert = this._insertRows || [this._insertData];
          const cols = Object.keys(rowsToInsert[0]);
          const colList = cols.join(", ");
          const valRows = rowsToInsert.map(r => cols.map(c => r[c]));
          let query = sql.unsafe(`INSERT INTO ${this.table} (${colList}) VALUES `);
          for (let i = 0; i < valRows.length; i++) {
            const vals = valRows[i];
            query = query.append(sql.unsafe("("));
            for (let j = 0; j < vals.length; j++) {
              query = query.append(sql`${vals[j]}`);
              if (j < vals.length - 1) query = query.append(sql.unsafe(", "));
            }
            query = query.append(sql.unsafe(")"));
            if (i < valRows.length - 1) query = query.append(sql.unsafe(", "));
          }
          query = query.append(sql.unsafe(" RETURNING *"));
          const rows = await query;
          const parsedRows = (rows as Array<Record<string, unknown>>).map(r => parseJsonbRow(r));
          if (this._single) return { data: parsedRows[0] || null, error: null };
          return { data: parsedRows, error: null };
        }

        // UPSERT
        if (this._upsertData) {
          const cols = Object.keys(this._upsertData);
          const colList = cols.join(", ");
          const vals = cols.map(c => this._upsertData![c]);
          let query = sql.unsafe(`INSERT INTO ${this.table} (${colList}) VALUES (`);
          for (let j = 0; j < vals.length; j++) {
            query = query.append(sql`${vals[j]}`);
            if (j < vals.length - 1) query = query.append(sql.unsafe(", "));
          }
          query = query.append(sql.unsafe(") ON CONFLICT DO UPDATE SET "));
          const updateCols = cols.filter(c => c !== "id");
          for (let j = 0; j < updateCols.length; j++) {
            query = query.append(sql.unsafe(`${updateCols[j]} = EXCLUDED.${updateCols[j]}`));
            if (j < updateCols.length - 1) query = query.append(sql.unsafe(", "));
          }
          query = query.append(sql.unsafe(" RETURNING *"));
          const rows = await query;
          const parsedRows2 = (rows as Array<Record<string, unknown>>).map(r => parseJsonbRow(r));
          if (this._single) return { data: parsedRows2[0] || null, error: null };
          return { data: parsedRows2, error: null };
        }

        // SELECT
        const selectCols = this._select === "*" ? "*" : this._select;
        let query = sql.unsafe(`SELECT ${selectCols} FROM ${this.table}`);
        query = this.appendWhere(query);
        if (this._orderBy) {
          query = query.append(sql.unsafe(` ORDER BY ${this._orderBy} ${this._ascending ? "ASC" : "DESC"}`));
        }
        if (this._limitN) {
          query = query.append(sql.unsafe(` LIMIT ${this._limitN}`));
        }

        if (this._head && this._countType === "exact") {
          let countQuery = sql.unsafe(`SELECT count(*)::int AS cnt FROM ${this.table}`);
          countQuery = this.appendWhere(countQuery);
          const countRows = await countQuery;
          return { data: null, error: null, count: (countRows[0] as Record<string, unknown>)?.cnt as number };
        }

        const rows = await query;
        const parsedRows3 = (rows as Array<Record<string, unknown>>).map(r => parseJsonbRow(r));
        if (this._single) return { data: parsedRows3[0] || null, error: null };
        return { data: parsedRows3, error: null };
      } catch (err) {
        return { data: null, error: { message: String(err) } };
      }
    }

    private appendWhere(query: ReturnType<typeof sql.unsafe>): ReturnType<typeof sql.unsafe> {
      if (this._where.length === 0) return query;
      query = query.append(sql.unsafe(" WHERE "));
      for (let i = 0; i < this._where.length; i++) {
        const w = this._where[i];
        if (i > 0) query = query.append(sql.unsafe(" AND "));
        if (w.col === "__or__") {
          const orParts = w.val as Array<{ col: string; op: string; val: string }>;
          query = query.append(sql.unsafe("("));
          for (let j = 0; j < orParts.length; j++) {
            const p = orParts[j];
            if (j > 0) query = query.append(sql.unsafe(" OR "));
            const sqlOp = p.op === "like" ? "LIKE" : p.op === "ilike" ? "ILIKE" : p.op === "eq" ? "=" : p.op === "neq" ? "!=" : p.op;
            query = query.append(sql.unsafe(`${p.col} ${sqlOp} `));
            query = query.append(sql`${p.val}`);
          }
          query = query.append(sql.unsafe(")"));
        } else if (w.op === "IS NULL") {
          query = query.append(sql.unsafe(`${w.col} IS NULL`));
        } else if (w.op === "IS NOT NULL") {
          query = query.append(sql.unsafe(`${w.col} IS NOT NULL`));
        } else if (w.op === "IN") {
          const vals = w.val as unknown[];
          query = query.append(sql.unsafe(`${w.col} IN (`));
          for (let j = 0; j < vals.length; j++) {
            query = query.append(sql`${vals[j]}`);
            if (j < vals.length - 1) query = query.append(sql.unsafe(", "));
          }
          query = query.append(sql.unsafe(")"));
        } else {
          query = query.append(sql.unsafe(`${w.col} ${w.op} `));
          query = query.append(sql`${w.val}`);
        }
      }
      return query;
    }
  }

  const client = {
    from(table: string) {
      return new QueryBuilder(table);
    },

    async rpc(funcName: string, params?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
      try {
        if (params && Object.keys(params).length > 0) {
          const keys = Object.keys(params);
          const namedArgs = keys.map((k, i) => k + " := $" + (i + 1)).join(", ");
          const values = keys.map(k => params[k]);
          const query = `SELECT * FROM ${funcName}(${namedArgs})`;
          const rows = await sql.unsafe(query, values as never);
          const data = unwrap(rows as unknown[]);
          return { data, error: null };
        } else {
          const rows = await sql.unsafe(`SELECT * FROM ${funcName}()`);
          const data = unwrap(rows as unknown[]);
          return { data, error: null };
        }
      } catch (err) {
        return { data: null, error: { message: String(err) } };
      }
    },

    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, data: Blob | ArrayBuffer | string, opts?: { contentType?: string; upsert?: boolean }): Promise<{ data: unknown; error: { message: string } | null }> {
            try {
              const contentType = opts?.contentType || "application/octet-stream";
              const headers: Record<string, string> = {
                "Authorization": `Bearer ${serviceRoleKey}`,
                "Content-Type": contentType,
              };
              if (opts?.upsert) headers["x-upsert"] = "true";
              const res = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${path}`, {
                method: "POST",
                headers,
                body: data as BodyInit,
              });
              if (!res.ok) return { data: null, error: { message: `Upload failed: ${res.status}` } };
              return { data: { path }, error: null };
            } catch (err) {
              return { data: null, error: { message: String(err) } };
            }
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}` } };
          },
        };
      },
    },

    async close() {
      await sql.end();
    },
  };

  return client;
}
