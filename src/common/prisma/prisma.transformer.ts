export const PrismaDateTransformer = {
  toPlain(obj: any) {
    if (obj instanceof Date) {
      return obj.toISOString(); // 🟢 Convertimos SIEMPRE a ISO válido
    }

    if (Array.isArray(obj)) {
      return obj.map((i) => PrismaDateTransformer.toPlain(i));
    }

    if (obj !== null && typeof obj === "object") {
      const newObj: any = {};
      for (const key of Object.keys(obj)) {
        newObj[key] = PrismaDateTransformer.toPlain(obj[key]);
      }
      return newObj;
    }

    return obj;
  },
};
