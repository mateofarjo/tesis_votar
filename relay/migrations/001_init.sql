-- Traza de auditoria del servicio de sufragio.
--
-- Esta base es distinta de la del padron, y la separacion es el control: un
-- operador con acceso de lectura a una de las dos no puede emparejar emisiones
-- de credencial con confirmaciones de voto, porque solo ve una de las dos
-- mitades.
--
-- No hay columna de votante, ni de credencial, ni de direccion de red, ni de
-- agente de usuario. No se trata de campos que se dejen en blanco: el servicio
-- nunca recibe esos datos, de modo que no existe la posibilidad de poblarlos mas
-- adelante por descuido.
CREATE TABLE IF NOT EXISTS relay_audit_logs (
    id         TEXT PRIMARY KEY,
    accion     TEXT NOT NULL,
    tx_hash    TEXT,
    bloque     INTEGER,
    creado_en  TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS relay_audit_logs_accion_idx ON relay_audit_logs(accion, creado_en);
