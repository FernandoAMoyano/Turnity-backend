import { PrismaClient, RoleName } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { addDays, subDays, addHours, format, setHours, setMinutes } from 'date-fns';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando el sembrado de la base de datos...');

  const existingUsers = await prisma.user.count();

  if (existingUsers > 0) {
    console.log(`Ya existen ${existingUsers} usuarios en la base de datos.`);
    console.log('Esto eliminara TODOS los datos existentes.');
  }

  // Limpiar datos existentes
  console.log('Limpiando datos existentes...');
  await prisma.payment.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.notificationStatus.deleteMany();
  await prisma.scheduleException.deleteMany();
  await prisma.holiday.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.appointmentStatus.deleteMany();
  await prisma.stylistService.deleteMany();
  await prisma.service.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.schedule.deleteMany();

  // Creacion de roles
  console.log('Creando roles...');
  const adminRole = await prisma.role.create({
    data: {
      name: RoleName.ADMIN,
      description: 'Administrador del sistema con acceso completo',
    },
  });

  const clientRole = await prisma.role.create({
    data: {
      name: RoleName.CLIENT,
      description: 'Cliente que puede agendar citas',
    },
  });

  const stylistRole = await prisma.role.create({
    data: {
      name: RoleName.STYLIST,
      description: 'Estilista que ofrece servicios',
    },
  });

  // Creacion de usuarios
  console.log('Creando usuarios...');

  // Admin
  const adminPassword = await bcrypt.hash('admin123', 10);
  const adminUser = await prisma.user.create({
    data: {
      name: 'Admin Usuario',
      email: 'admin@turnity.com',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      phone: '123456789',
      password: adminPassword,
      roleId: adminRole.id,
      profilePicture: 'https://randomuser.me/api/portraits/men/1.jpg',
    },
  });
  console.log(`Admin creado: ${adminUser.email}`);

  // Clientes - preferences directo en User
  const clientPassword = await bcrypt.hash('client123', 10);
  const client1 = await prisma.user.create({
    data: {
      name: 'Maria Garcia',
      email: 'maria@example.com',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      phone: '612345678',
      password: clientPassword,
      roleId: clientRole.id,
      profilePicture: 'https://randomuser.me/api/portraits/women/2.jpg',
      preferences: 'Prefiere citas por la tarde, le gusta el estilo moderno',
    },
  });

  const client2 = await prisma.user.create({
    data: {
      name: 'Juan Perez',
      email: 'juan@example.com',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      phone: '623456789',
      password: clientPassword,
      roleId: clientRole.id,
      profilePicture: 'https://randomuser.me/api/portraits/men/3.jpg',
      preferences: 'Prefiere citas por la manana, estilo clasico',
    },
  });

  // Estilistas - sin tabla Stylist, User.id se usa directamente
  const stylistPassword = await bcrypt.hash('stylist123', 10);
  const stylist1 = await prisma.user.create({
    data: {
      name: 'Lucia Rodriguez',
      email: 'lucia@turnity.com',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      phone: '634567890',
      password: stylistPassword,
      roleId: stylistRole.id,
      profilePicture: 'https://randomuser.me/api/portraits/women/4.jpg',
    },
  });

  const stylist2 = await prisma.user.create({
    data: {
      name: 'Carlos Sanchez',
      email: 'carlos@turnity.com',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      phone: '645678901',
      password: stylistPassword,
      roleId: stylistRole.id,
      profilePicture: 'https://randomuser.me/api/portraits/men/5.jpg',
    },
  });

  // Creacion de categorias de servicios
  console.log('Creando categorias de servicios...');
  const hairCategory = await prisma.category.create({
    data: {
      name: 'Cabello',
      description: 'Servicios relacionados con el cabello',
    },
  });

  const facialCategory = await prisma.category.create({
    data: {
      name: 'Facial',
      description: 'Servicios para el cuidado facial',
    },
  });

  const nailsCategory = await prisma.category.create({
    data: {
      name: 'Unas',
      description: 'Servicios de manicura y pedicura',
    },
  });

  // Creacion de servicios
  console.log('Creando servicios...');
  const services = await Promise.all([
    prisma.service.create({
      data: {
        name: 'Corte de cabello',
        description: 'Corte y estilo segun preferencias',
        duration: 30,
        durationVariation: 15,
        price: 2500, // $25.00 en centavos
        categoryId: hairCategory.id,
      },
    }),
    prisma.service.create({
      data: {
        name: 'Tinte de cabello',
        description: 'Coloracion completa',
        duration: 90,
        durationVariation: 30,
        price: 6000, // $60.00 en centavos
        categoryId: hairCategory.id,
      },
    }),
    prisma.service.create({
      data: {
        name: 'Tratamiento facial',
        description: 'Limpieza e hidratacion facial',
        duration: 45,
        durationVariation: 15,
        price: 4000, // $40.00 en centavos
        categoryId: facialCategory.id,
      },
    }),
    prisma.service.create({
      data: {
        name: 'Manicura',
        description: 'Cuidado y pintado de unas',
        duration: 45,
        durationVariation: 15,
        price: 2000, // $20.00 en centavos
        categoryId: nailsCategory.id,
      },
    }),
  ]);

  // Asignacion de servicios a estilistas - stylistId es User.id directamente
  console.log('Asignando servicios a estilistas...');
  await prisma.stylistService.createMany({
    data: [
      { stylistId: stylist1.id, serviceId: services[0].id }, // Corte
      { stylistId: stylist1.id, serviceId: services[1].id }, // Tinte
      { stylistId: stylist1.id, serviceId: services[2].id }, // Facial
    ],
  });

  await prisma.stylistService.createMany({
    data: [
      { stylistId: stylist2.id, serviceId: services[0].id }, // Corte
      { stylistId: stylist2.id, serviceId: services[3].id }, // Manicura
    ],
  });

  // Creacion de estados de citas
  console.log('Creando estados de citas...');
  const pendingStatus = await prisma.appointmentStatus.create({
    data: {
      name: 'PENDING',
      description: 'Cita agendada pero pendiente de confirmacion',
    },
  });

  const confirmedStatus = await prisma.appointmentStatus.create({
    data: {
      name: 'CONFIRMED',
      description: 'Cita confirmada',
    },
  });

  const completedStatus = await prisma.appointmentStatus.create({
    data: {
      name: 'COMPLETED',
      description: 'Cita realizada con exito',
    },
  });

  const cancelledStatus = await prisma.appointmentStatus.create({
    data: {
      name: 'CANCELLED',
      description: 'Cita cancelada',
    },
  });

  // Creacion de horarios
  console.log('Creando horarios...');
  const schedules = await Promise.all([
    prisma.schedule.create({
      data: {
        dayOfWeek: 'MONDAY',
        startTime: '09:00',
        endTime: '18:00',
      },
    }),
    prisma.schedule.create({
      data: {
        dayOfWeek: 'TUESDAY',
        startTime: '09:00',
        endTime: '18:00',
      },
    }),
    prisma.schedule.create({
      data: {
        dayOfWeek: 'WEDNESDAY',
        startTime: '09:00',
        endTime: '18:00',
      },
    }),
    prisma.schedule.create({
      data: {
        dayOfWeek: 'THURSDAY',
        startTime: '09:00',
        endTime: '18:00',
      },
    }),
    prisma.schedule.create({
      data: {
        dayOfWeek: 'FRIDAY',
        startTime: '09:00',
        endTime: '18:00',
      },
    }),
    prisma.schedule.create({
      data: {
        dayOfWeek: 'SATURDAY',
        startTime: '10:00',
        endTime: '14:00',
      },
    }),
  ]);

  // Creacion de dias festivos
  console.log('Creando dias festivos...');
  const christmasDate = new Date(Date.UTC(2025, 11, 25));
  const christmasHoliday = await prisma.holiday.create({
    data: {
      name: 'Navidad',
      date: christmasDate,
      description: 'Cerrado por Navidad',
    },
  });

  const newYearDate = new Date(Date.UTC(2026, 0, 1));
  const newYearHoliday = await prisma.holiday.create({
    data: {
      name: 'Ano Nuevo',
      date: newYearDate,
      description: 'Cerrado por Ano Nuevo',
    },
  });

  // Creacion de excepciones de horario
  console.log('Creando excepciones de horario...');
  const christmasEveDate = new Date(Date.UTC(2025, 11, 24));
  await prisma.scheduleException.create({
    data: {
      holidayId: christmasHoliday.id,
      exceptionDate: christmasEveDate,
      startTimeException: '09:00',
      endTimeException: '14:00',
      reason: 'Horario reducido en Nochebuena',
    },
  });

  // Creacion de estados de notificaciones
  console.log('Creando estados de notificaciones...');
  const pendingNotifStatus = await prisma.notificationStatus.create({
    data: {
      name: 'PENDING',
      description: 'Notificacion pendiente de envio',
    },
  });

  const sentNotifStatus = await prisma.notificationStatus.create({
    data: {
      name: 'SENT',
      description: 'Notificacion enviada exitosamente',
    },
  });

  const readNotifStatus = await prisma.notificationStatus.create({
    data: {
      name: 'READ',
      description: 'Notificacion leida por el usuario',
    },
  });

  const failedNotifStatus = await prisma.notificationStatus.create({
    data: {
      name: 'FAILED',
      description: 'Error al enviar la notificacion',
    },
  });

  // Creacion de citas de ejemplo
  console.log('Creando citas de ejemplo...');
  const today = new Date();
  const futureDate = addDays(today, 7);
  const futureDateAt10 = setMinutes(setHours(futureDate, 10), 0);

  const appointment1 = await prisma.appointment.create({
    data: {
      userId: client1.id,
      clientId: client1.id,
      stylistId: stylist1.id,
      statusId: confirmedStatus.id,
      scheduleId: schedules[0].id,
      dateTime: futureDateAt10,
      duration: 45,
      confirmedAt: new Date(),
      services: {
        connect: [{ id: services[0].id }],
      },
    },
  });

  const pastDate = subDays(today, 7);
  const pastDateAt15 = setMinutes(setHours(pastDate, 15), 0);

  const appointment2 = await prisma.appointment.create({
    data: {
      userId: client2.id,
      clientId: client2.id,
      stylistId: stylist2.id,
      statusId: completedStatus.id,
      scheduleId: schedules[2].id,
      dateTime: pastDateAt15,
      duration: 60,
      confirmedAt: subDays(pastDateAt15, 1),
      services: {
        connect: [{ id: services[0].id }, { id: services[3].id }],
      },
    },
  });

  // Creacion de pagos
  console.log('Creando pagos...');
  await prisma.payment.create({
    data: {
      appointmentId: appointment2.id,
      amount: 45.0,
      status: 'COMPLETED',
      method: 'CREDIT_CARD',
      paymentDate: addHours(pastDateAt15, 1),
    },
  });

  // Creacion de notificaciones
  console.log('Creando notificaciones...');
  await prisma.notification.create({
    data: {
      userId: client1.id,
      statusId: sentNotifStatus.id,
      type: 'APPOINTMENT_CONFIRMATION',
      message: `Tu cita para el ${format(futureDateAt10, 'dd/MM/yyyy')} a las ${format(futureDateAt10, 'HH:mm')} ha sido confirmada.`,
      sentAt: new Date(),
    },
  });

  await prisma.notification.create({
    data: {
      userId: client1.id,
      statusId: pendingNotifStatus.id,
      type: 'APPOINTMENT_REMINDER',
      message: `Recordatorio: Tienes una cita manana ${format(futureDateAt10, 'dd/MM/yyyy')} a las ${format(futureDateAt10, 'HH:mm')}.`,
      sentAt: null,
    },
  });

  await prisma.notification.create({
    data: {
      userId: client2.id,
      statusId: sentNotifStatus.id,
      type: 'APPOINTMENT_CONFIRMATION',
      message: `Gracias por visitarnos! Tu cita del ${format(pastDateAt15, 'dd/MM/yyyy')} ha sido completada exitosamente.`,
      sentAt: addHours(pastDateAt15, 2),
    },
  });

  // Resumen final
  const finalUserCount = await prisma.user.count();
  console.log(`Sembrado completado con exito!`);
  console.log(`Total de usuarios creados: ${finalUserCount}`);
  console.log(`Credenciales de prueba:`);
  console.log(`  Admin: admin@turnity.com / admin123`);
  console.log(`  Cliente: maria@example.com / client123`);
  console.log(`  Estilista: lucia@turnity.com / stylist123`);

  // Log de variables no utilizadas (para debugging)
  console.log(`Variables disponibles para uso futuro:`, {
    adminUserId: adminUser.id,
    pendingStatusId: pendingStatus.id,
    cancelledStatusId: cancelledStatus.id,
    newYearHolidayId: newYearHoliday.id,
    appointment1Id: appointment1.id,
    readNotifStatusId: readNotifStatus.id,
    failedNotifStatusId: failedNotifStatus.id,
  });
}

main()
  .catch((e) => {
    console.error('Error durante el sembrado:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
