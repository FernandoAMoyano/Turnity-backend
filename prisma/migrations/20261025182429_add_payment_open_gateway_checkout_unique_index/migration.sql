-- Un solo checkout de pasarela abierto por cita. La condicion abarca solo los
-- pagos de pasarela pendientes: un pago manual pendiente, o uno de pasarela ya
-- resuelto, no cuenta. Prisma no expresa indices parciales en el schema, asi que
-- el indice existe solo en esta migracion.
CREATE UNIQUE INDEX "Payment_appointmentId_open_gateway_checkout_key"
  ON "Payment" ("appointmentId")
  WHERE "status" = 'PENDING' AND "provider" <> 'MANUAL';
