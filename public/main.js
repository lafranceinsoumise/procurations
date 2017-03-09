/* eslint-env browser, jquery */
$(function() {
  $('#commune-input').selectize({
    load: function(query, callback) {
      if (!query.length) return callback();
      console.log('http://api-adresse.data.gouv.fr/search/?q=' + query + '&type=municipality');
      $.ajax({
        url: 'https://api-adresse.data.gouv.fr/search/?q=' + query + '&type=municipality&limit=20',
        dataType: 'json',
        success: function(res) {
          var list = res.features.map(function(feature) {
            return {
              citycode: feature.properties.citycode,
              label: feature.properties.city + ' (' + feature.properties.postcode + ')'
            };
          });
          return callback(list);
        }
      });
    },
    searchField: 'label',
    valueField: 'citycode',
    labelField: 'label',
    maxItems: 1,
    create: false
  });
});
