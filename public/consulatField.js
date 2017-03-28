/* eslint-env browser, jquery */
$(function() {
  var $select = $('#consulat-input').selectize({
    valueField: 'label',
    labelField: 'label',
    searchField: ['country', 'consulat'],
    maxItems: 1,
    create:false
  });

  $.ajax({
    url: '/public/bureaux_etranger.json',
    dataType: 'json',
    success: function(res) {
      var list = res.map(function(feature) {
        return {
          country: capitalize(feature.country),
          consulat: capitalize(feature.consulat),
          label: capitalize(feature.consulat) + ', ' + capitalize(feature.country)
        };
      });

      $select[0].selectize.addOption(list);
    }
  });
});

function capitalize(str) {
  return str.toLowerCase().replace(/(^| )(\w)/g, function(s) {
    return s.toUpperCase();
  });
}
