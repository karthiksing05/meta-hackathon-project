//! Static types of the game language (spec A4).

use std::fmt;
use std::rc::Rc;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Type {
    Bool,
    Int,
    Float,
    Str,
    IVec2,
    Vec2,
    List(Rc<Type>),
    Set(Rc<Type>),
    Map(Rc<Type>, Rc<Type>),
    Grid(Rc<Type>),
    /// `T?`. Never nested (`T??` is a type error). At runtime a present value
    /// is stored unwrapped and an absent one is `Value::None`.
    Option(Rc<Type>),
    /// Enum members, in declaration order. Runtime values are `Value::Str`.
    Enum(Rc<[Rc<str>]>),
    Record(Rc<RecordType>),
    /// Placeholder used by the checker for error recovery and for empty
    /// literals (`[]`, `none`) whose type is not yet known. Never appears in a
    /// successfully lowered program's declared types.
    Unknown,
}

/// Structural record type. Fields are kept **sorted by name**, so the field
/// index of a name is the same for every structurally equal record type and
/// the IR can address fields by index.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct RecordType {
    pub fields: Vec<(Rc<str>, Type)>,
}

impl RecordType {
    /// Builds a record type, sorting fields by name. Duplicate names are the
    /// caller's problem (the checker reports them).
    pub fn new(mut fields: Vec<(Rc<str>, Type)>) -> Self {
        fields.sort_by(|a, b| a.0.cmp(&b.0));
        RecordType { fields }
    }

    pub fn index_of(&self, name: &str) -> Option<usize> {
        self.fields.binary_search_by(|f| (*f.0).cmp(name)).ok()
    }

    pub fn field(&self, name: &str) -> Option<&Type> {
        self.index_of(name).map(|i| &self.fields[i].1)
    }
}

impl Type {
    pub fn list(t: Type) -> Type {
        Type::List(Rc::new(t))
    }
    pub fn set(t: Type) -> Type {
        Type::Set(Rc::new(t))
    }
    pub fn grid(t: Type) -> Type {
        Type::Grid(Rc::new(t))
    }
    pub fn option(t: Type) -> Type {
        Type::Option(Rc::new(t))
    }
    pub fn map(k: Type, v: Type) -> Type {
        Type::Map(Rc::new(k), Rc::new(v))
    }
    pub fn record(fields: Vec<(Rc<str>, Type)>) -> Type {
        Type::Record(Rc::new(RecordType::new(fields)))
    }
    pub fn is_numeric(&self) -> bool {
        matches!(self, Type::Int | Type::Float)
    }
    pub fn is_unknown(&self) -> bool {
        matches!(self, Type::Unknown)
    }
}

impl fmt::Display for Type {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Type::Bool => write!(f, "bool"),
            Type::Int => write!(f, "int"),
            Type::Float => write!(f, "float"),
            Type::Str => write!(f, "string"),
            Type::IVec2 => write!(f, "ivec2"),
            Type::Vec2 => write!(f, "vec2"),
            Type::List(t) => write!(f, "list<{t}>"),
            Type::Set(t) => write!(f, "set<{t}>"),
            Type::Map(k, v) => write!(f, "map<{k}, {v}>"),
            Type::Grid(t) => write!(f, "grid<{t}>"),
            Type::Option(t) => write!(f, "{t}?"),
            Type::Enum(m) => {
                write!(f, "enum(")?;
                for (i, s) in m.iter().enumerate() {
                    if i > 0 {
                        write!(f, " | ")?;
                    }
                    write!(f, "'{s}'")?;
                }
                write!(f, ")")
            }
            Type::Record(r) => {
                write!(f, "{{")?;
                for (i, (n, t)) in r.fields.iter().enumerate() {
                    if i > 0 {
                        write!(f, ", ")?;
                    }
                    write!(f, "{n}: {t}")?;
                }
                write!(f, "}}")
            }
            Type::Unknown => write!(f, "?"),
        }
    }
}
