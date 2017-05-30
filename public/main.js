/* eslint-env browser, jquery */
$(function() {
  var communeSelectize = $('#commune-input').selectize({
    load: function(query, callback) {
      if (!query.length) return callback();
      query = $('#zipcode').length > 0 ? (query + ',' + $('#zipcode').val()) : query;
      var url = 'https://api-adresse.data.gouv.fr/search/?q=' + query + '&type=municipality&limit=20';
      $.ajax({
        url: url,
        dataType: 'json',
        success: function(res) {
          var list = res.features.map(function(feature) {
            return {
              citycode: feature.properties.citycode,
              label: feature.properties.city + ', ' + feature.properties.context
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

  if ($('#zipcode').length > 0) {
    $('#zipcode').change(updateCommuneField);
    updateCommuneField();
  }

  function updateCommuneField() {
    if (!$('#zipcode').val() || $('#zipcode').val().length !== 5) {
      communeSelectize[0].selectize.disable();
    } else {
      communeSelectize[0].selectize.enable();
    }
  }
});
