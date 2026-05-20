/** Consistent success envelope for JSON APIs (errors use Nest HTTP exceptions). */
export type StandardSuccess<T> = {
  success: true;
  data: T;
};

export function ok<T>(data: T): StandardSuccess<T> {
  return { success: true, data };
}
