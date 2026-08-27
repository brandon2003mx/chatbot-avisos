# Base de datos

La aplicación utiliza **Cloud Firestore** como base de datos NoSQL.

## Estructura general

```text
Firestore
│
├── carreras/
│   └── {carreraId}
│       └── semestres/
│           └── {semestreId}
│               └── grupos/
│                   └── {grupoId}
│
├── estudiantes/
│   └── {estudianteId}
│
├── usuarios/
│   └── {usuarioId}
│
└── avisos/
    └── {avisoId}
