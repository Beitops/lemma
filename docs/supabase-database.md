# Base de datos Supabase de Lemma

Este documento describe el esquema multiobjetivo. El grafo relacional es la fuente de verdad; ni el Markdown renderizado ni una solución limpia sustituyen su historia.

## Estado del esquema

La cadena contiene once migraciones versionadas. La novena, `20260831194541_multi_objectives.sql`, realiza un corte beta intencional: elimina los tres workspaces anteriores y después introduce objetivos, contexto por ámbito y resultados por target. Las dos siguientes añaden la indexación semántica asíncrona y ajustan su cadencia para el presupuesto de cómputo de la demo.

Antes del corte se conservaron:

- los tres enunciados y su contexto de entrada en `docs/legacy-problems.md`;
- una copia exacta de las ocho migraciones remotas anteriores en `supabase/baselines/20260831_pre_multi_objective_migrations`;
- el ledger remoto, hashes y fingerprint del catálogo en el `BASELINE.md` de esa carpeta.

La baseline reconstruye el esquema anterior en una base vacía, pero no recupera soluciones ni pasos descartados. El bucket privado `workspace-context` tenía `0` objetos y `0` bytes antes del corte, por lo que el reset no deja uploads legacy huérfanos.

Métricas del catálogo en el checkpoint multiobjetivo, después de aplicar las primeras nueve migraciones:

- 19 tablas de Lemma: 16 públicas y 3 internas;
- 26 funciones públicas ejecutables por `authenticated`;
- 62 triggers no internos;
- 51 políticas RLS;
- 123 índices, contando claves primarias y restricciones únicas;
- bucket privado `workspace-context`, con límite de 50 MB por archivo;
- extensiones `vector` y `pgtap`.

## Mapa del agregado

```text
Workspace
├── ContextItems generales
└── Objectives
    ├── ContextItems específicos
    └── Strategies
        ├── resultado opcional de strategy
        └── Branches
            ├── resultado opcional de branch
            └── Steps
                ├── revisiones
                ├── dependencias
                ├── assumptions
                └── sources
```

Un workspace nuevo es un contenedor vacío. El usuario crea sus objetivos después. Cada objetivo mantiene su propio board; la UI muestra uno a la vez.

## Tablas públicas

### `workspaces`

Contenedor y límite de autorización. Guarda propietario, título, estado y revisión. Ya no guarda el enunciado ni las restricciones.

### `objectives`

Guarda título, `objective_markdown`, restricciones, estado, autoría y revisión. Pertenece a un único workspace y tiene identidad compuesta `(id, workspace_id)` para validar las relaciones descendientes.

Estados: `active`, `completed`, `archived`.

### `context_items`

Guarda texto, notas, enlaces y metadatos de archivos privados.

- `objective_id IS NULL`: contexto general del workspace;
- `objective_id` no nulo: contexto específico de ese objetivo;
- contexto efectivo: general + específico del objetivo seleccionado.

El ámbito es procedencia estructural y no se puede cambiar después de crear el item. Para archivos, Postgres guarda la ruta y metadata; el objeto vive en Storage.

### `strategies`, `branches` y `steps`

Cada strategy pertenece exactamente a un objective y a su workspace. Al crearla mediante `create_strategy`, la base crea también su rama raíz en la misma transacción.

Las branches conservan `parent_branch_id` y `forked_from_step_id`; no copian pasos heredados ni destruyen alternativas. Los steps mantienen posición, Markdown + TeX, autoría, estado, conceptos, tags y relación de supersesión.

### `reasoning_results`

No existe un resultado único del workspace u objective. Cada fila apunta a uno de estos targets:

- una strategy (`branch_id IS NULL`), como máximo una fila por strategy;
- una branch concreta, como máximo una fila por branch.

`target_type` y `target_id` son columnas generadas. El resultado registra la revisión exacta del target, revisión propia, autoría y uno de estos outcomes: `successful`, `unsuccessful`, `inconclusive`.

Un resultado no exige que la strategy o branch esté completada. Puede editarse con concurrencia optimista sin reescribir pasos ni borrar historia. La elección futura de un resultado “principal” del objetivo queda deliberadamente fuera de este esquema.

### Relaciones y trazabilidad

- `step_revisions`: historial inmutable de versiones de steps;
- `step_dependencies`: aristas explícitas entre steps del mismo objective; pueden cruzar branches;
- `assumptions` y `step_assumptions`: hipótesis de primer nivel y su uso;
- `sources` y `step_sources`: citas y procedencia;
- `decisions`: preguntas/intervenciones generales, de objective, strategy, branch o step;
- `activity_events`: actividad, actor, entidad y revisión;
- `clean_solution_snapshots`: copias guardadas de una proyección de branch.

Una fuente vinculada a contexto específico solo puede citarse desde steps de ese mismo objective. Una fuente de contexto general puede reutilizarse en cualquiera de sus objetivos.

## Tablas internas

### `private.step_search_documents`

Mantiene el texto derivado para búsqueda, `tsvector`, hash y campos de embedding. El trigger invalida un embedding cuando cambia su representación indexable.

### `private.mutation_receipts`

Hace idempotentes las mutaciones que ya conocen su `workspace_id`.

### `private.workspace_creation_receipts`

Hace idempotente `create_workspace`, que todavía no dispone de UUID de workspace. La clave se separa por propietario autenticado.

## Invariantes de ámbito

- Los FKs compuestos impiden relacionar un objective con un workspace distinto.
- Las dependencias de steps no pueden cruzar objectives.
- `compare_branches` exige que ambas branches pertenezcan al mismo objective.
- El RAG es la excepción intencional: busca todo el workspace por defecto y `objective_id` solo estrecha resultados.
- Las decisiones generales pendientes aparecen en cada board; las decisiones de un objective hermano no se filtran al board activo.
- Los resultados verifican el target, su objective/workspace y la revisión vigente.
- Identidad, pertenencia, autor original y procedencia de contexto son inmutables.

## RPCs principales

### Escrituras del agregado

| RPC | Responsabilidad |
|---|---|
| `create_workspace`, `update_workspace` | Crear el shell vacío y editarlo con idempotencia/revisión. |
| `create_objective`, `update_objective` | Crear o editar un objetivo del workspace. |
| `create_context_item` | Crear contexto general o específico; para uploads acepta el UUID ya usado en Storage. |
| `create_strategy` | Crear strategy y rama raíz de forma atómica. |
| `create_step`, `update_step`, `mark_step_dead_end` | Mantener pasos e historia. |
| `branch_from_step`, `mark_branch_completed` | Crear alternativas o completar una rama. |
| `set_reasoning_result` | Crear o editar un outcome de strategy/branch. |
| `mark_assumption` | Crear y conectar una hypothesis. |
| `request_human_decision`, `resolve_human_decision` | Mantener el bucle humano-agente. |
| `save_clean_solution_snapshot` | Guardar explícitamente una proyección. |

### Lecturas

| RPC | Responsabilidad |
|---|---|
| `list_workspace_summaries` | Dashboard sin consultas N+1. |
| `get_workspace_overview` | Shell, lista compacta de objectives y contexto general. |
| `get_context`, `get_general_context` | Contexto por ámbito. |
| `get_objective_graph` | Un board completo, contexto general/específico y resultados. |
| `get_branch_path` | Camino heredado completo de una branch. |
| `find_steps` | Retrieval híbrido workspace-wide con filtros opcionales. |
| `compare_branches` | Prefijo común y divergencias de dos branches del mismo objective. |
| `generate_clean_solution` | Proyección Markdown no mutante de una branch. |

Las RPC normales de aplicación son `SECURITY INVOKER`, usan `search_path = ''` y ejecutan con la sesión normal del usuario. Las tres RPC internas del worker de embeddings son la excepción: usan `SECURITY DEFINER`, sólo conceden `EXECUTE` a `service_role` y además validan un token aleatorio guardado en Vault.

## RLS, grants y frontera de escritura

Todas las tablas públicas e internas de Lemma tienen RLS. `anon` no tiene acceso; `authenticated` solo opera sobre workspaces propios. No existe `DELETE` normal del grafo: dead ends, archivo y supersesión preservan historia.

El código del navegador y WebMCP enruta las mutaciones por `lemma-api`, que valida los mismos contratos Zod y llama a las RPC transaccionales. Los grants de tabla a `authenticated` siguen siendo necesarios para las RPC `SECURITY INVOKER`; por tanto, “solo RPC” es hoy una frontera de aplicación, mientras RLS y triggers son la frontera de seguridad e integridad. Si en el futuro se exige impedir incluso a un cliente autenticado propietario cualquier escritura directa, habrá que introducir un rol RPC dedicado o convertir de forma auditada toda la superficie mutante a `SECURITY DEFINER`; no conviene hacerlo solo para las dos tablas nuevas.

## Storage

El bucket `workspace-context` es privado. Las rutas son estables por intento lógico y están bajo:

```text
<user_id>/<workspace_id>/<context_item_id>/context
```

Se permiten PDF, PNG, JPEG, WebP, texto y Markdown. Los uploads son inmutables. La API verifica que la ruta y metadata pertenecen al caller antes de crear `context_items`; un retry conserva la identidad lógica y no sobrescribe un objeto distinto.

## Retrieval y embeddings

`find_steps` combina full-text y pgvector mediante RRF. Siempre exige `workspace_id`, puede filtrar por objective, strategy, branch y estado, limita `top_k` y devuelve provenance completa, incluido objective de origen. Los embeddings usan `gte-small`, 384 dimensiones y un identificador versionado; el ranking semántico sólo compara documentos del mismo modelo.

La población es asíncrona: un trigger encola cambios de `content_hash` en PGMQ, `pg_cron` invoca cada 30 segundos el worker Edge a través de `pg_net`, y cada invocación reclama un trabajo. El worker completa o reprograma el mensaje con visibility timeout, backoff exponencial y un máximo de cinco intentos. `lemma-api` genera el vector de la consulta sólo después de autorizar el workspace y conserva full-text como fallback explícito. El diseño, resultado del despliegue y runbook completos están en [semantic-step-retrieval.md](./semantic-step-retrieval.md).

## Migraciones y recuperación

El historial activo es:

1. `20260829185844_initial_reasoning_graph.sql`
2. `20260829190008_harden_security_and_foreign_key_indexes.sql`
3. `20260829190233_fix_activity_actor_fallback.sql`
4. `20260830170110_find_steps_workspace_scope.sql`
5. `20260830175702_english_clean_solution.sql`
6. `20260831102307_workspace_completion_results.sql`
7. `20260831102502_index_workspace_results_author.sql`
8. `20260831152948_workspace_graph_rpc.sql`
9. `20260831194541_multi_objectives.sql`
10. `20260901124241_add_queued_step_embeddings.sql`
11. `20260901125010_slow_embedding_worker_cron.sql`

La segunda migración activa contiene un guard condicional para `public.rls_auto_enable()`: el helper existía en el proyecto remoto original, pero no en una base Supabase local limpia. La copia en la baseline permanece byte-a-byte igual al estado pre-corte.

## Validación

Validación realizada para este cambio:

- 54 tests unitarios pasan entre contratos, cliente/WebMCP y las dos Edge Functions;
- los tipos estrictos de contratos, `lemma-api`, `embed-steps` y `database.types.ts` pasan;
- el test estructural remoto alcanzó su aserción 72 con la migración aplicada;
- el backfill real terminó con 26/26 embeddings del modelo activo y la cola vacía;
- la prueba de ranking confirmó `semantic_rank = 1`, scope workspace-wide sobre dos objectives y filtros objective/strategy/branch correctos.

El test transaccional de cola permanece preparado en `supabase/tests/queued_step_embeddings.sql`, pero no se ejecutó contra el proyecto remoto porque purga temporalmente la cola y el cron estaba activo. Tampoco se ejecutó localmente porque Docker/Supabase local no estaba iniciado; no se hizo ningún reset destructivo.

Los asesores remotos de seguridad y rendimiento deben ejecutarse de nuevo después de cada cambio DDL.

## Decisiones aplazadas

- seleccionar un resultado principal de objective;
- ordenar objectives manualmente;
- decidir si completar todas las strategies completa automáticamente el objective;
- promover/copiar contexto entre ámbitos conservando provenance;
- representar de forma más rica referencias RAG entre objectives;
- endurecer toda la superficie a escrituras exclusivamente RPC a nivel de privilegios;
- cuando haya volumen medido, evaluar HNSW con `vector_cosine_ops` y un plan real.
