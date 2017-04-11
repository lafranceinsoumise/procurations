# procurations

## Installation

You need a Redis server on localhost and Node >= 7.6.

```bash
$ git clone https://github.com/jlm2017/procurations.git
$ cd procurations
$ cp config.js.dist config.js
$ npm install
$ npm start
```

This project works well with [Mosaico standalone](https://github.com/jlm2017/mosaico-standalone) to create email templates.

## Remerciements

Ce site utilise la [base d'adresse nationale](http://adresse.data.gouv.fr/).

## Liste des clés Redis

| Clé                          | Valeur
|------------------------------|-------------
|totp:[user]                   | Totp key of `[user]`
|requests:all                  | Liste des adresses emails demandant procuration
|requests:[token]              | Adresse email validé par [token]
|requests:[email]:valid        | `false` ou une date si le lien de validation a été cliqué
|requests:[email]:commune      | Ville de la personne (texte)
|requests:[email]:insee        | Code INSEE de la personne
|requests:[email]:match        | Email du match si trouvé
|requests:[email]:matchDate    | Date où le mail de match a été envoyé
|requests:confirmations:[token]| token de confirmation
|[email]:posted                | `true` si la personne a validé avoir déposé la procuration
|invitations:all               | toutes les personnes ayant été invitée à prendre une procuration
|invitations:[token]           | Adresse email validé par [token]
|invitations:[email]:date      | date de la proposition par le système
|offers:all                    | toutes les personnes ayant rempli le formulaire pour prendre une procuration
|offers:[insee]                | la même liste par ville
|offers:[email]                | infos en JSON : email, first_name, last_name, phone, date, zipcode, address1, address2, commune
|offers:[email]:match          | email de la personne demandant procuration si match
|offers:confirmations:[token]  | token de confirmation
|commmune:[insee]              | données sur la commune, au format JSON, avec deux clés : `name` et `context`
|code-postaux:[insee]          | le tableau des codes postaux de la sommune, en JSON
