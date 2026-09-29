import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Regla de revision exigida por la Fase 2 del plan de remediacion (docs/):
 * "Anadir una prueba/regla de revision que falle si el endpoint de voto importa
 *  sesion, Prisma o acepta un identificador de votante."
 *
 * La propiedad central del sistema no es una propiedad del contrato sino de la
 * arquitectura que lo rodea: el endpoint de voto no debe poder saber de quien
 * proviene la credencial que recibe. Es una propiedad facil de romper sin
 * advertirlo, porque cualquier import aparentemente inocuo la destruye, y por eso
 * se verifica sobre el codigo fuente y no sobre el comportamiento.
 */
const FUENTE = readFileSync(
  path.join(process.cwd(), "app", "api", "voto", "route.ts"),
  "utf8"
);

describe("frontera de anonimato del endpoint de voto", () => {
  it("no importa la capa de sesion ni de autenticacion", () => {
    expect(FUENTE).not.toMatch(/from\s+["'][^"']*\/(auth|session)["']/);
    expect(FUENTE).not.toMatch(/next-auth/);
    expect(FUENTE).not.toMatch(/getServerAuthSession|getServerSession|getToken/);
  });

  it("no importa el cliente de base de datos", () => {
    expect(FUENTE).not.toMatch(/from\s+["'][^"']*\/prisma["']/);
    expect(FUENTE).not.toMatch(/@prisma\/client/);
    expect(FUENTE).not.toMatch(/\bprisma\./);
  });

  it("no acepta ni propaga un identificador de votante", () => {
    for (const prohibido of ["voterId", "voteTokenId", "dniHash", "dni"]) {
      expect(FUENTE).not.toMatch(new RegExp(`\\b${prohibido}\\b`));
    }
  });

  it("no registra metadatos que reidentifiquen al emisor", () => {
    // getClientIp se usa solo para el limitador de tasa; la IP y el user-agent
    // no deben llegar a la traza de auditoria de las acciones anonimas.
    expect(FUENTE).not.toMatch(/getUserAgent/);
    expect(FUENTE).not.toMatch(/ipHash|userAgentHash/);
  });
});
