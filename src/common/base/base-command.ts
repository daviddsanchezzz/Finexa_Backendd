export abstract class BaseCommand<T> {
  abstract create(data: any): Promise<T>;
  abstract findAll(): Promise<T[]>;
  abstract findById(id: string): Promise<T | null>;
  abstract update(id: string, data: any): Promise<T | null>;
  abstract delete(id: string): Promise<T | null>;
}
