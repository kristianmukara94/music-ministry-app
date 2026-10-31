// Database access shared by the functions. `tagFromQuery` turns a plain query function into the tagged-template form the
// handlers use, with every value sent as a parameter. The transaction helper is how every admin change is made.
export function tagFromQuery(query) {
  return (strings, ...values) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
    return query(text, values).then((result) => result.rows);
  };
}
