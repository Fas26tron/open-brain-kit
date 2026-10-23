# Règles de définition : domaines, personae, chief of staff, sparring partner, rétention

*English: [en/rules.md](en/rules.md).*

Ce document fixe ce que chaque notion veut dire et comment la définir pour qu'elle fonctionne. Les procédures sont dans [advisors.md](advisors.md) ; ici, ce sont les règles.

## 1. Les domaines

Un **domaine** est une zone de votre vie ou de votre travail : « Artinary et Arts Lab », « Forward College », « Vie personnelle ». Les domaines partitionnent la mémoire : chaque thought porte le ou les domaines auxquels il appartient.

**Règles**

1. **Il existe toujours un domaine par défaut**, créé à l'installation sous le nom « Vie personnelle ». Tout ce que le classement ne rattache clairement à aucun autre domaine y va. C'est le choix sûr : un thought mal classé finit du côté privé, jamais du côté d'une persona de travail.
2. **Un thought peut avoir plusieurs domaines**, s'il mêle vraiment plusieurs sujets. Une conversation qui parle de votre société et de votre famille porte les deux.
3. **Le classement est fait chaque nuit** par un modèle léger, à partir de la description de chaque domaine. Il se corrige par une phrase : « cette conversation sur X va dans Forward College ». Un domaine créé ou modifié ne reclasse pas l'existant ; demandez « reclasse tout » si c'est nécessaire.
4. **Un domaine se définit par sa description, pas par son nom.** C'est la description que lit le classeur. Elle doit dire ce qui appartient au domaine **et ce qui n'y appartient pas**, avec des mots-clés : noms de projets, de personnes, d'institutions, de produits.

**Exemple de bonne description** : « Artinary et Arts Lab : le produit Artinary (compagnon de visite de musée, reconnaissance d'œuvres, audio), la société Arts Lab, son financement, ses partenariats avec les musées et les fondations, l'équipe (Alex, Aline), la roadmap, le business plan. N'inclut pas : mes investissements personnels dans d'autres sociétés, ma famille, mes voyages même quand je visite un musée. Mots-clés : Artinary, Arts Lab, Musea, Orsay, Louvre, audioguide. »

**Exemple de mauvaise description** : « Mon travail. » Le classeur ne peut rien en faire.

5. **Trois à six domaines** est la bonne taille. Au-delà, le classement hésite et les personae manquent de matière. Un projet n'est pas un domaine : c'est le chief of staff qui suit les projets, à l'intérieur d'un domaine.

## 2. Les personae

Une **persona** est un personnage que vous interrogez : investisseur, expert-comptable, salarié, banquier, client, directeur de musée. Elle répond dans son rôle, à partir des faits qu'elle a le droit de voir.

**Règles**

1. **Une persona appartient à un seul domaine** et ne voit que les thoughts de ce domaine. Un thought qui porte aussi un autre domaine lui est invisible : c'est la règle stricte, qui protège le privé au prix d'un fait parfois manquant.
2. **Elle ne voit jamais les thoughts marqués `restricted` ou `personal`**, ni le profil du sparring partner, quel que soit son domaine.
3. **Elle se définit en cinq champs**, chacun en une ou deux phrases : qui elle est ; ce qu'elle cherche ou protège ; ce qui la fait dire non ; ce qui la fait dire oui ; ce qu'elle ne doit pas savoir. Les quatre premiers font la qualité de la réponse ; le cinquième est une consigne de jeu, pas une barrière. La barrière, ce sont le domaine et les filtres.
4. **Restreindre ses sources quand c'est possible.** Une persona « extérieure » (investisseur, banquier) devrait ne voir que les affirmations curées ou les documents, jamais les transcriptions brutes de vos conversations, qui contiennent vos hésitations. Une persona « intérieure » (salarié, associé) peut en voir davantage.
5. **Écrire la persona comme un adversaire loyal**, pas comme un allié. Ce qui la fait dire non est le champ le plus utile : c'est lui qui produit les objections que vous n'aviez pas vues.

**Exemple** : « Professeur salarié de l'école, dix ans d'ancienneté. Cherche : la qualité pédagogique et une charge de travail tenable. Dit non à ce qui ajoute des heures sans moyens, à ce qui est décidé sans consulter l'équipe. Dit oui à ce qui valorise son métier et à ce qui est testé à petite échelle d'abord. Ne sait pas : les finances de l'école, les discussions avec les investisseurs. Domaine : Forward College. Sources : affirmations curées. »

## 3. Le chief of staff

Le **chief of staff** est unique et global. Il suit vos **projets**, chacun rattaché à un domaine, et produit des états des lieux : par domaine ou pour tout.

**Règles**

1. **Un projet se déclare avec son domaine, son type et ce qu'il faut surveiller.** Le type est `stratégique` (durable, ne doit pas être oublié) ou `autonome` (à finir, puis clos). « Ce qu'il faut surveiller » guide la recherche nocturne : « bêta, retours visiteurs, mise en ligne » vaut mieux que rien.
2. **Il ne vous demande rien.** Il déduit l'état des projets du brain, de vos dépôts git si vous en avez, de vos sessions Claude Code. Il ne vous pose une question que lorsqu'une décision vous appartient.
3. **Il propose, il ne décide pas.** Quand un sujet revient dans vos conversations sans être déclaré, il le propose avec son domaine ; vous l'adoptez ou non.
4. **La section « ce dont tu t'éloignes » est toujours présente**, même vide. C'est sa fonction de recentrage : les projets stratégiques sans activité depuis plus de trois semaines, avec la durée.
5. **Il lit tous les domaines.** Un état des lieux « Forward College » ne montre que les projets de ce domaine, mais sa connaissance de vos autres domaines reste disponible si vous la demandez.

## 4. Le sparring partner

Le **sparring partner** est unique et global. Il vous connaît par un **profil** distillé chaque nuit de vos conversations : positions datées, revirements, réactions à des conseils, forces et faiblesses, règles pour vous challenger.

**Règles**

1. **Il voit tout**, tous les domaines, tous les niveaux de sensibilité. C'est ce qui lui permet de rappeler qu'une décision prise dans un domaine contredit ce que vous envisagez dans un autre.
2. **Son profil est confidentiel par construction** : stocké à part, jamais dans les thoughts, inaccessible aux personae.
3. **Il apprend par ajout, jamais par réécriture.** Chaque nuit ajoute des lignes datées sous les sections existantes du profil. Rien n'est supprimé : une position dépassée descend dans les revirements avec sa date.
4. **Vous le relisez une fois par semaine.** « Qu'est-ce que mon sparring partner sait de moi ? » Un profil qui apprend sans relecture finit par vous décrire de travers sur un point sans que vous le sachiez. Corrigez par « remplace mon profil par… » ou en éditant le texte.
5. **On peut cadrer une question dans un domaine** : « sparring, dans le cadre de Forward College… ». Il répond dans ce cadre en s'appuyant sur le reste.
6. **Il n'est pas un thérapeute.** Il reflète les schémas visibles dans vos conversations, avec précision si le profil est bien distillé. Il ne diagnostique pas.

## 5. La rétention

Open Brain ne retient pas toutes vos interactions. La règle, appliquée par l'extension Chrome avant l'envoi :

1. **Une conversation est retenue si vous y intervenez au moins trois fois, ou si vos messages totalisent au moins 600 caractères**, même en une seule fois. Une question ponctuelle, un numéro de téléphone, un hôtel ne sont pas retenus.
2. **« Open Brain, retiens »** écrit dans la conversation, dans n'importe quel client, force la capture. **« Open Brain, oublie »** l'empêche. Une conversation déjà capturée se supprime par « oublie la conversation sur X » (l'outil `forget` montre ce qu'il va effacer avant d'effacer).
3. **Une conversation trop courte est réexaminée à chaque synchronisation** et capturée dès qu'elle dépasse la règle.
4. **Les notes dictées à l'app Claude ne sont pas concernées** : elles passent par `capture_thought`, une phrase suffit.
5. **Une conversation qui s'allonge remplace sa version précédente.** Chaque synchronisation renvoie la conversation entière ; le serveur garde la nouvelle version, reprend les domaines et la sensibilité réglés à la main sur l'ancienne, puis supprime l'ancienne. Le job nocturne ne relit que la partie nouvelle.
6. **La rétention enlève le jetable ; le domaine range le reste.** Une conversation de trois tours sur un hôtel sera retenue, et ira en « Vie personnelle », invisible aux personae de travail.

## 6. La sensibilité

Indépendante du domaine, la **sensibilité** d'un thought vaut `standard`, `personal` ou `restricted` (convention Open Brain). Les personae n'accèdent jamais aux deux derniers niveaux ; la recherche depuis vos clients exclut `restricted` par défaut ; le sparring partner voit tout.

Utilisez-la pour ce qui doit rester hors de portée de toute persona, quel que soit le domaine : santé, argent personnel, conflits. « Marque cette conversation comme restreinte » suffit quand l'outil correspondant est branché ; sinon, le niveau se règle dans la table `thoughts`.

## 7. Ce que le job nocturne fait, dans l'ordre

Le job avance sur la date d'**entrée dans le brain** (`captured_at`), pas sur la date réelle de la conversation : une conversation de 2024 importée aujourd'hui, ou reprise aujourd'hui, est bien traitée cette nuit.

1. **Classe** les nouveaux thoughts dans les domaines.
2. **Distille** les nouveaux thoughts dans le profil du sparring partner.
3. **Met à jour** l'état des projets du chief of staff et propose les projets non déclarés.

Chaque étape est bornée ; un gros retard se résorbe en quelques nuits, ou immédiatement par « lance la distillation maintenant » répété.
