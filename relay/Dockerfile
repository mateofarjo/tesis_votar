# Servicio de sufragio de Vot.Ar.
#
# Imagen propia y deliberadamente minima: este servicio se despliega aparte del
# de identidad, idealmente en otro proveedor y con otras credenciales, de modo
# que un mismo operador no observe las dos puntas del flujo.
FROM node:22-alpine

WORKDIR /app

# Las dependencias se instalan en una capa propia para aprovechar la cache.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# No corre como root: el proceso maneja la clave de la billetera que paga el gas.
USER node

ENV NODE_ENV=production
ENV RELAY_PORT=3100
EXPOSE 3100

# El esquema de auditoria se crea al arrancar (CREATE TABLE IF NOT EXISTS), de
# modo que desplegar no requiere un paso de migracion manual.
CMD ["node", "server.js"]
