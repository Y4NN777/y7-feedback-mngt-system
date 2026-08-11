## Résultat livré

<!-- Décrire le comportement observable livré, pas seulement les fichiers modifiés. -->

## Traçabilité

- Task(s) :
- Requirements / invariants / ADR :
- Plan ou issue liée :

## Scénarios BDD

<!-- Lister les scénarios Given/When/Then couverts, avec leurs identifiants. -->

- [ ] Résultat nominal
- [ ] Refus d’autorisation non divulguant, si applicable
- [ ] Validation des entrées et limites
- [ ] Retry/idempotence et conflit de payload, si applicable
- [ ] Échec forcé à chaque frontière atomique, si applicable

## Architecture et sécurité

- [ ] Le scope Workspace/Project provient de données serveur faisant autorité
- [ ] Les dépendances pointent vers des ports métier ciblés et respectent SOLID
- [ ] Aucun secret, Access Proof, token fournisseur ou contenu privé n’est exposé
- [ ] Logs, réponses, caches et assets utilisent des projections explicitement autorisées
- [ ] Les erreurs protégées sont stables, typées et non divulguantes
- [ ] Aucun fichier généré, rapport de couverture, environnement local ou transcript brut n’est commité

## Expérience utilisateur

<!-- Cocher N/A uniquement si cette PR ne modifie aucun parcours ou rendu. -->

- [ ] FR/EN et conservation des saisies
- [ ] Clavier et noms accessibles
- [ ] État compréhensible sans dépendre uniquement de la couleur
- [ ] Aucun débordement à 320 px
- [ ] N/A — aucun changement d’interface

## Preuves exécutées

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm test:e2e
pnpm security:scan
```

Résultats et chemins d’évidence :

- Tests :
- Couverture :
- E2E :
- Scan sécurité :
- Preuve de service réel, si requise :
- Résumé de session :

## Risques, rollback et blocages

- Risques résiduels :
- Rollback :
- Services ou preuves externes encore `BLOCKED` :

## Revue et historique

- [ ] Commits atomiques, verts et attribués au compte personnel `Y4NN777`
- [ ] Aucun commit temporaire/fixup et aucun trailer `Co-Authored-By`
- [ ] Historique linéaire ; aucun développement direct sur `main`
- [ ] CI complète requise avant merge
- [ ] Aucun résultat Appwrite/Vercel/GitHub/GitLab n’est inféré depuis un mock local

## Checklist de merge

- [ ] La PR est reviewable et chaque changement peut être revert indépendamment
- [ ] Les refus, retries et échecs significatifs sont testés
- [ ] Les dépendances et changements de production sont explicitement revus
- [ ] Le ledger du Goal et le résumé de session reflètent l’état réel
- [ ] Les preuves réelles exigées sont jointes, ou la tâche reste explicitement `BLOCKED`
