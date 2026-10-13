/// <reference types="jest" />
/**
 * Fronteras entre el servicio de identidad y el de sufragio.
 *
 * La propiedad central del sistema no reside en el contrato sino en la
 * arquitectura que lo rodea, y la separacion de estos dos servicios es lo que la
 * sostiene: mientras ambos compartian proceso y base de datos, un operador veia
 * las dos puntas —quien pidio una credencial y cuando se emitio un voto— y podia
 * emparejarlas.
 *
 * Es una propiedad que un solo import destruye sin que ninguna prueba funcional
 * lo advierta, de modo que se verifica sobre el texto de los modulos y no sobre
 * su comportamiento.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const RAIZ = process.cwd();
const RELAY = path.join(RAIZ, "relay");

function fuentesDelRelay(): Array<{ ruta: string; texto: string }> {
  const archivos: string[] = [];
  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      if (entrada.name === "node_modules" || entrada.name === "abi") continue;
      const completa = path.join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(completa);
      else if (entrada.name.endsWith(".js")) archivos.push(completa);
    }
  };
  recorrer(RELAY);
  return archivos.map((ruta) => ({
    ruta: path.relative(RAIZ, ruta),
    texto: readFileSync(ruta, "utf8")
  }));
}

describe("el servicio de identidad no recibe sufragios", () => {
  it("ya no expone un endpoint de voto", () => {
    expect(existsSync(path.join(RAIZ, "app", "api", "voto"))).toBe(false);
  });

  it("el cliente envia el voto al servicio separado y no a este servidor", () => {
    const servicio = readFileSync(path.join(RAIZ, "app", "services", "election.ts"), "utf8");
    expect(servicio).toMatch(/NEXT_PUBLIC_RELAY_URL/);
    // Enrutar el voto por el propio servidor reintroduciria la correlacion.
    expect(servicio).not.toMatch(/fetch\(\s*["'`]\/api\/voto/);
    // Y el navegador no debe adjuntar la sesion a esa peticion.
    expect(servicio).toMatch(/credentials:\s*"omit"/);
  });
});

describe("el servicio de sufragio no alcanza la identidad", () => {
  const fuentes = fuentesDelRelay();

  it("tiene fuentes que analizar", () => {
    expect(fuentes.length).toBeGreaterThan(3);
  });

  it("no importa el cliente de base de datos del padron", () => {
    for (const { ruta, texto } of fuentes) {
      expect(`${ruta}: ${texto}`).not.toMatch(/@prisma\/client|\/prisma["']|\bprisma\./);
    }
  });

  it("no usa la cadena de conexion del padron", () => {
    for (const { ruta, texto } of fuentes) {
      // Solo RELAY_DATABASE_URL: su propia base, distinta de la del padron.
      expect(`${ruta}`).toBeDefined();
      expect(texto).not.toMatch(/\bDATABASE_URL\b(?!.*RELAY)/);
      expect(texto).not.toMatch(/process\.env\.DATABASE_URL/);
    }
  });

  it("no conoce la clave privada con la que se firman las credenciales", () => {
    // Si la necesitara para funcionar, podria emitir credenciales por su cuenta
    // y la separacion dejaria de significar algo.
    for (const { texto } of fuentes) {
      expect(texto).not.toMatch(/RSA_PRIVATE_KEY/);
    }
  });

  it("no menciona identificadores de votante ni de sesion", () => {
    for (const { texto } of fuentes) {
      for (const prohibido of ["voterId", "voteTokenId", "dniHash", "sessionId", "next-auth"]) {
        expect(texto).not.toMatch(new RegExp(`\\b${prohibido}\\b`));
      }
    }
  });

  it("no registra direccion de red ni agente de usuario", () => {
    for (const { texto } of fuentes) {
      expect(texto).not.toMatch(/ipHash|userAgentHash|user-agent/i);
    }
  });

  it("su esquema de auditoria carece de columnas de identidad", () => {
    const sql = readFileSync(path.join(RELAY, "migrations", "001_init.sql"), "utf8");
    for (const columna of ["voter", "votante", "ip", "user_agent", "dni"]) {
      expect(sql.toLowerCase()).not.toMatch(new RegExp(`^\\s*${columna}\\w*\\s+(text|varchar|integer)`, "mi"));
    }
  });
});
